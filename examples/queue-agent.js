"use strict";
// Example: message-queue agent with ORF v0.2 receipts.
//
// This example shows the AMBIGUOUS resolution case — the case neither
// file-agent.js nor http-agent.js reaches. It arises naturally with queues:
// a message that was enqueued may have been consumed before the agent rebooted,
// so on recovery the queue is empty but the action may have succeeded.
//
// Key lesson: world_state_read must capture what you *actually observed*.
// When the queue has no peek API, that IS the observation — write it down.
// "queue.peek returned NOT_FOUND" is honest and actionable: it tells a future
// agent (or a human) what information was available when the reconcile was made.
//
// Resolution rules:
//   completed     — message found in queue (pre-consume) or acknowledged receipt
//   not_completed — durable broker error at enqueue (write rejected, not just absent)
//   ambiguous     — message absent, but absence could mean consumed OR never sent
//
// Run: node examples/queue-agent.js [completed|not_completed|ambiguous]
// Default: ambiguous (the novel case)
//
// The demo seeds a prior open decision in the ledger first, then runs the agent
// so the boot reconcile fires and you see all three stages in one run.

const orf = require("../reference/helper");
const fs = require("fs");
const os = require("os");
const path = require("path");

const LEDGER = path.join(os.tmpdir(), "orf-queue-agent-example.jsonl");
const AGENT = "queue-agent-example";
const QUEUE_ENDPOINT = "amqp://broker.internal/notifications";
const PRIOR_MSG_ID = "notify-user-123-prior";
const PRIOR_DECISION_ID = `enqueue-notification-${PRIOR_MSG_ID}`;

const MODE = process.argv[2] || "ambiguous";

// ─── Simulated queue ──────────────────────────────────────────────────────────
// A real broker would be e.g. AMQP/SQS/Kafka. Simulated here so the example
// runs without a broker. Replace with your client in a real agent.

function simulatedBroker() {
  const enqueue = () => {
    if (MODE === "not_completed") return { ok: false, error: "QUEUE_FULL: persistent error, message not accepted" };
    return { ok: true };
  };

  // peek: returns the message if still in the queue, null if absent or unreadable
  const peek = (id) => {
    if (MODE === "completed") return { id, payload: "notify-user-123", enqueued_at: new Date().toISOString() };
    // ambiguous or not_completed: message gone (consumed, expired, or never enqueued)
    return null;
  };

  return { enqueue, peek };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function emit(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

// world_state_read for a queue action.
//
// Unlike a file (inspectable via stat+hash) or an HTTP resource (inspectable via GET),
// a queue message may be unreadable: already consumed, in a write-only topic, or
// behind broker auth that only the consumer holds. In those cases, the honest
// world_state_read is the observation itself: "queue.peek returned NOT_FOUND."
//
// Do NOT write what you hoped to observe. Write what you actually observed.
function readQueueState(broker, msgId) {
  const msg = broker.peek(msgId);
  if (msg) {
    return `queue.peek(${msgId}): FOUND — enqueued_at=${msg.enqueued_at}`;
  }
  // null can mean: (a) consumed before peek, (b) never sent, (c) broker has no peek API
  return `queue.peek(${msgId}): NOT_FOUND — message absent; may have been consumed, never sent, or broker has no read API`;
}

// ─── Seed a prior open decision ───────────────────────────────────────────────
// In a real crash scenario, the prior decision would already be on disk.
// Here we write it explicitly so the boot reconcile fires in one run.

fs.rmSync(LEDGER, { force: true });
emit(
  LEDGER,
  orf.decision(PRIOR_DECISION_ID, {
    actor: AGENT,
    intent: "Enqueue user notification (prior run — simulating crash before outcome)",
    precondition: `queue.peek(${PRIOR_MSG_ID}): NOT_FOUND — no prior message`,
    rule: "enqueue when no open unreconciled decision for this notification",
    action: `POST ${QUEUE_ENDPOINT} body={id:${PRIOR_MSG_ID},type:signup_confirm}`,
    idempotencyKey: PRIOR_MSG_ID,
    falsifier: {
      type: "string",
      value: "user did not receive signup_confirm email within 10 minutes of this decision"
    },
    confidence: 0.85,
    reconClass: "recomputable"
  })
);
console.log(`[prior] seeded open decision: ${PRIOR_DECISION_ID}`);
console.log(`[prior] mode=${MODE} — boot reconcile will produce resolution=${MODE}\n`);

// ─── Boot: reconcile any open decision ────────────────────────────────────────

const ledger = loadLedger(LEDGER);
const lastDecision = ledger.filter((r) => r.record === "decision").slice(-1)[0];
const alreadyReconciled =
  lastDecision && ledger.some((r) => r.record === "reconcile" && r.open_decision_id === lastDecision.id);

if (lastDecision && !alreadyReconciled) {
  const broker = simulatedBroker();
  const stateNow = readQueueState(broker, PRIOR_MSG_ID);
  const msg = broker.peek(PRIOR_MSG_ID);

  let resolution, gapDetected, notes;

  if (msg) {
    // Message still in queue — action completed (not yet consumed).
    gapDetected = false;
    resolution = "completed";
    notes = "";
  } else if (MODE === "not_completed") {
    // Prior run's broker error was recorded in notes/context — message never accepted.
    gapDetected = true;
    resolution = "not_completed";
    notes = "Broker rejected the enqueue (QUEUE_FULL). Message never entered the queue. Safe to retry.";
  } else {
    // Message absent but no durable error — the ambiguous case.
    //
    // WHY ambiguous and not not_completed: absence alone does not prove the
    // action failed. A fast consumer may have processed the message before the
    // agent rebooted. We cannot distinguish "never sent" from "sent and consumed."
    //
    // What to do next:
    //   - If consumer is idempotent: re-enqueue with the same idempotency key.
    //     A duplicate will be a no-op. This is the safe default.
    //   - If consumer is NOT idempotent: check downstream state (did the user
    //     receive the notification?) before retrying.
    gapDetected = true;
    resolution = "ambiguous";
    notes =
      `Message absent from queue (queue.peek=${PRIOR_MSG_ID}: NOT_FOUND). ` +
      "Cannot determine whether consumed before crash or never sent. " +
      `Re-enqueue with the same idempotency key (${PRIOR_MSG_ID}) if consumer is idempotent; ` +
      "otherwise verify downstream state before retrying.";
  }

  const rec = emit(
    LEDGER,
    orf.reconcile(`reconcile-${lastDecision.id}`, {
      openDecisionId: lastDecision.id,
      worldStateRead: stateNow,
      gapDetected,
      resolution,
      notes
    })
  );
  console.log(`[boot] reconcile: resolution=${rec.resolution} gap=${gapDetected}`);
  if (notes) console.log(`[boot] notes: ${notes}`);
  console.log();
}

// ─── Read world state before new decision ─────────────────────────────────────

const NEW_MSG_ID = `notify-user-456-${Date.now()}`;
const broker = simulatedBroker();

// ─── Decide ───────────────────────────────────────────────────────────────────

const newDecisionId = `enqueue-notification-${NEW_MSG_ID}`;

const dec = emit(
  LEDGER,
  orf.decision(newDecisionId, {
    actor: AGENT,
    intent: "Enqueue user notification for signup confirmation",
    precondition: `queue.peek(${NEW_MSG_ID}): NOT_FOUND — no prior message with this id`,
    rule: "enqueue when no open unreconciled decision for this notification",
    action: `POST ${QUEUE_ENDPOINT} body={id:${NEW_MSG_ID},type:signup_confirm}`,
    idempotencyKey: NEW_MSG_ID,
    falsifier: {
      type: "string",
      value: "user did not receive signup_confirm email within 10 minutes of this decision"
    },
    confidence: 0.85,
    reconClass: "recomputable"
  })
);
console.log(`[decide] ${dec.id}`);

// ─── Act ──────────────────────────────────────────────────────────────────────
const result = broker.enqueue(NEW_MSG_ID);

// ─── Outcome ──────────────────────────────────────────────────────────────────
// For a write-only queue: we cannot read back. Record the broker's acknowledgment.
// falsifier_observed=null (undetermined) because checking "did user get email?"
// requires downstream state we do not have at enqueue time.
// falsifier_observed=true (falsified) if the broker rejected the message.

emit(
  LEDGER,
  orf.outcome(newDecisionId, {
    observedResult: result.ok
      ? `broker accepted enqueue; msg_id=${NEW_MSG_ID}`
      : `broker rejected enqueue: ${result.error}`,
    falsifierObserved: result.ok ? null : true
  })
);
console.log(`[outcome] broker_ok=${result.ok} status=${result.ok ? "undetermined" : "falsified"}`);

// ─── Show the ledger ──────────────────────────────────────────────────────────
console.log("\n--- ledger ---");
for (const r of loadLedger(LEDGER)) {
  console.log(JSON.stringify(r, null, 2));
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(LEDGER, { force: true });
