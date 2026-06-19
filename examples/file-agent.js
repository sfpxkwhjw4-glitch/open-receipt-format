"use strict";
// Example: file-writing agent with ORF v0.2 receipts.
//
// This example shows how world_state_read differs for file actions:
// capture the file's *actual state* (exists, content hash), not just a path.
// A path is not state. The hash is state.
//
// Run: node examples/file-agent.js
// Writes a temp ledger and config file, then reads them back and cleans up.

const orf = require("../reference/helper");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");

const LEDGER = path.join(os.tmpdir(), "orf-file-agent-example.jsonl");
const TARGET = path.join(os.tmpdir(), "orf-example-config.json");
const AGENT = "file-agent-example";

function sha256(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 12);
}

// world_state_read for a file action: capture what you can check later.
// A future reconcile record will read these same fields and compare.
function readFileState(p) {
  const exists = fs.existsSync(p);
  return `path=${p} exists=${exists} sha256=${sha256(p) || "none"}`;
}

function loadLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function emit(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

// ─── Boot: reconcile any open decision ────────────────────────────────────────
// On every boot, check whether the last decision completed or was interrupted.
// This is the crash gap: a pre-sleep receipt proves intent, not completion.

const ledger = loadLedger(LEDGER);
const lastDecision = ledger.filter((r) => r.record === "decision").slice(-1)[0];
const alreadyReconciled =
  lastDecision && ledger.some((r) => r.record === "reconcile" && r.open_decision_id === lastDecision.id);

if (lastDecision && !alreadyReconciled) {
  // Read the world now and compare to what the pre-sleep receipt promised.
  const stateNow = readFileState(TARGET);
  const expectedHash = lastDecision.action_idempotency_key; // we stored the content hash as the key
  const actualHash = sha256(TARGET);
  const gapDetected = !fs.existsSync(TARGET) || actualHash !== expectedHash;

  const rec = emit(
    LEDGER,
    orf.reconcile(`reconcile-${lastDecision.id}`, {
      openDecisionId: lastDecision.id,
      worldStateRead: stateNow,
      gapDetected,
      resolution: gapDetected ? "not_completed" : "completed",
      notes: gapDetected ? "file absent or hash mismatch — safe to retry with same idempotency key" : ""
    })
  );
  console.log(`[boot] reconcile: ${rec.resolution} (gap=${gapDetected})`);
}

// ─── Decide ───────────────────────────────────────────────────────────────────
// Record the decision before acting. If we crash after this and before the write,
// the reconcile on the next boot will find gapDetected=true and retry safely.

const payload = { version: 2, retry_budget_ms: 500, updated_by: AGENT };
const contentHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(payload, null, 2))
  .digest("hex")
  .slice(0, 12);
const decisionId = `write-config-v2-${contentHash}`;

const dec = emit(
  LEDGER,
  orf.decision(decisionId, {
    actor: AGENT,
    intent: "Write config v2 to reduce retry noise",
    precondition: readFileState(TARGET),
    rule: "write when version < 2 and no pending unreconciled decision",
    action: `write JSON to ${TARGET}`,
    // action_idempotency_key is the key for the SIDE EFFECT (the file write),
    // not the receipt. We use the content hash so a retry writes the same bytes.
    idempotencyKey: contentHash,
    // uri falsifier: a future agent can resolve this without trusting the author.
    // "The file does NOT contain version=2" is the condition that proves us wrong.
    falsifier: {
      type: "uri",
      value: `file://${TARGET} — field version != 2`,
      window_seconds: 600
    },
    confidence: 0.92,
    reconClass: "irrecoverable" // once overwritten, the old config is gone
  })
);
console.log(`[decide] ${dec.id}`);

// ─── Act ──────────────────────────────────────────────────────────────────────
fs.writeFileSync(TARGET, JSON.stringify(payload, null, 2));

// ─── Outcome ──────────────────────────────────────────────────────────────────
// Check the falsifier: is version != 2? If so, the action failed.
const written = JSON.parse(fs.readFileSync(TARGET, "utf8"));
const falsifierObserved = written.version !== 2;

emit(
  LEDGER,
  orf.outcome(decisionId, {
    observedResult: `file written; version=${written.version} sha256=${sha256(TARGET)}`,
    falsifierObserved
  })
);
console.log(`[outcome] status=${falsifierObserved ? "falsified" : "held"}`);

// ─── Show the ledger ──────────────────────────────────────────────────────────
console.log("\n--- ledger ---");
for (const r of loadLedger(LEDGER)) {
  console.log(JSON.stringify(r, null, 2));
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(LEDGER, { force: true });
fs.rmSync(TARGET, { force: true });
