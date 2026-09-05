"use strict";
// Example: coordinator-seat handoff across a council, with ORF v0.10 custody records.
//
// Four peer agents share one coordinator seat. Each is metered on its own budget
// window, so the seat has to move before a holder runs out — and the successor
// has to pick up in-flight work WITHOUT redoing it. That second half is the
// point: a handoff that relocates the work without an inheritance list just
// moves the problem.
//
// Key rules:
//   - seat_epoch increases by exactly 1 per custody record; only one record per
//     epoch is valid, so two agents can never both hold the seat.
//   - Succession is computed, not negotiated: greatest remaining_fraction, ties
//     by earliest resets_at, then smallest agent id. Every member gets the same
//     answer, so a holder that dies mid-handoff strands nothing.
//   - The incoming holder MUST reconcile every open_decisions entry BEFORE it
//     dispatches anything new.
//   - When nobody is eligible, the holder writes to_agent: null with resume_at —
//     the earliest reset among exhausted members. That record is the wake trigger.
//
// Run: node examples/council-handoff.js [clean|redo_attempt]
//   clean        — the successor reconciles first and skips completed work (default)
//   redo_attempt — the successor tries to re-dispatch completed work; the guard stops it

const orf = require("../reference/recorder");
const fs = require("fs");
const os = require("os");
const path = require("path");

const LEDGER = path.join(os.tmpdir(), "orf-council-example.jsonl");
const WAKE_FILE = path.join(os.tmpdir(), "orf-council-example.wake.json");
const COUNCIL = "orf-dev-council";
const MODE = process.argv[2] || "clean";

fs.rmSync(LEDGER, { force: true });
fs.rmSync(WAKE_FILE, { force: true });

// A fixed clock keeps the output reproducible.
let t = Date.parse("2026-09-05T16:00:00Z");
const tick = (mins) => new Date((t += mins * 60_000)).toISOString();
const now = () => new Date(t).toISOString();

const append = (rec) => orf.appendRecord(LEDGER, rec);
const ledger = () => orf.loadLedger(LEDGER);

// ─── The council ──────────────────────────────────────────────────────────────
// remaining_fraction is self-reported: ORF records what the holder claimed, not
// what the provider metered.

const roster = [
  { agent: "chatgpt-5",       role: "hand", status: "available",  remaining_fraction: 0.31, resets_at: "2026-09-05T21:00:00Z" },
  { agent: "claude-opus-5",   role: "hand", status: "available",  remaining_fraction: 0.91, resets_at: "2026-09-05T22:30:00Z" },
  { agent: "gemini-3.8-flash",role: "hand", status: "available",  remaining_fraction: 0.74, resets_at: "2026-09-05T23:15:00Z" },
  { agent: "grok-4.6",        role: "hand", status: "onboarding", remaining_fraction: 1.00, resets_at: "2026-09-06T00:05:00Z" }
];

const member = (id) => roster.find((m) => m.agent === id);
const snapshot = (seatHolder) =>
  roster.map((m) => ({ ...m, role: m.agent === seatHolder ? "coordinator" : m.role }));

// ─── 1. chatgpt-5 claims an empty seat (epoch 0) ──────────────────────────────

append(orf.buildCustody({
  id: "custody-0000", council: COUNCIL, seat_epoch: 0,
  from_agent: null, to_agent: "chatgpt-5", reason: "seat_claimed",
  budget: { window_seconds: 18000, remaining_fraction: 0.31, resets_at: member("chatgpt-5").resets_at },
  roster: snapshot("chatgpt-5")
}, tick(0)));
console.log("[epoch 0]  chatgpt-5 claims an empty seat\n");

// ─── 2. It dispatches two units of work, then runs low ────────────────────────

append(orf.buildDelegation({
  id: "deploy-cfg-v2", delegating_agent: "chatgpt-5", delegate_agent: "gemini-3.8-flash",
  delegated_intent: "Deploy config v2 to the staging cluster and confirm error_rate",
  delegate_ledger: `orf://${COUNCIL}/gemini-ledger`, action_idempotency_key: "deploy-cfg-v2",
  falsifier: { type: "uri", value: "GET /metrics/error_rate — rate > 0.8% within 1h", window_seconds: 3600 }
}, tick(5)));

append(orf.buildDelegation({
  id: "import-batch-7", delegating_agent: "chatgpt-5", delegate_agent: "grok-4.6",
  delegated_intent: "Import batch 7 (3,100 records) and report row counts",
  delegate_ledger: `orf://${COUNCIL}/grok-ledger`, action_idempotency_key: "import-batch-7",
  falsifier: "row count after import differs from 3,100"
}, tick(2)));
console.log("[epoch 0]  dispatched: deploy-cfg-v2 (gemini), import-batch-7 (grok)");

// The deploy finishes and is recorded. The import does not — that is the crash gap.
append(orf.buildOutcome({
  decision_id: "deploy-cfg-v2",
  observed_result: "config_version=2, service running, error_rate fell 0.4% -> 0.1%",
  falsifier_observed: false
}, tick(9)));
console.log("[epoch 0]  deploy-cfg-v2 closed: held");
console.log("[epoch 0]  import-batch-7 still open — no outcome recorded\n");

// grok-4.6 wrote one conforming record, so it is no longer onboarding.
member("grok-4.6").status = "available";
console.log("[roster]   grok-4.6 appended a conforming record -> status: available (now seat-eligible)\n");

// ─── 3. Budget-low handoff (epoch 1) ──────────────────────────────────────────
// Written at 6%, not at 0.5%: a handoff with no budget left to enumerate the
// in-flight work is worse than no handoff at all.

member("chatgpt-5").remaining_fraction = 0.06;
const successor = orf.nextSeat(snapshot("chatgpt-5"), "chatgpt-5");
console.log(`[handoff]  nextSeat() -> ${successor} (highest remaining budget among eligible members)`);

append(orf.buildCustody({
  id: "custody-0001", council: COUNCIL, seat_epoch: 1,
  from_agent: "chatgpt-5", to_agent: successor, reason: "budget_low",
  budget: { window_seconds: 18000, remaining_fraction: 0.06, resets_at: member("chatgpt-5").resets_at },
  roster: snapshot(successor),
  open_decisions: ["deploy-cfg-v2", "import-batch-7"],
  falsifier: {
    type: "predicate",
    value: `no custody record at seat_epoch 2, or ${successor} dispatches before reconciling open_decisions`,
    window_seconds: 300
  }
}, tick(1)));
member("chatgpt-5").status = "exhausted";
console.log(`[epoch 1]  seat -> ${successor}; inherited open_decisions: deploy-cfg-v2, import-batch-7\n`);

// ─── 4. The successor reconciles BEFORE dispatching ───────────────────────────

const seat = orf.currentSeat(ledger(), COUNCIL);
console.log(`[epoch 1]  ${seat.agent} holds the seat. Guards before any dispatch:`);

for (const id of orf.unreconciled(ledger(), seat.record)) {
  const guard = orf.resolveGuard(ledger(), id);
  console.log(`             [unless ${id} is held] -> ${guard}`);

  if (guard === "skip") {
    console.log(`             ${id}: already held. Not re-dispatched, no second receipt.`);
    append(orf.buildReconcile({
      id: `reconcile-${id}`, open_decision_id: id,
      world_state_read: "config_version=2, service running, error_rate=0.1%",
      gap_detected: false, resolution: "completed", prior_outcome_status: "held",
      notes: `Inherited from chatgpt-5 at seat_epoch 1. Deploy landed; no re-dispatch.`
    }, tick(1)));
  } else {
    // "reconcile" — a decision exists but nothing closed it. Read the world; do
    // not guess. Guessing skip drops the work; guessing execute double-imports.
    console.log(`             ${id}: unresolved. Reading the world before deciding.`);
    append(orf.buildReconcile({
      id: `reconcile-${id}`, open_decision_id: id,
      world_state_read: "import table row count = 0; no partial batch present",
      gap_detected: true, resolution: "not_completed",
      notes: "Inherited from chatgpt-5 at seat_epoch 1. Import never ran; safe to re-dispatch."
    }, tick(1)));
    append(orf.buildDelegation({
      id: "import-batch-7-retry", delegating_agent: seat.agent, delegate_agent: "gemini-3.8-flash",
      delegated_intent: "Re-import batch 7 (3,100 records) — reconcile found row count 0",
      action_idempotency_key: "import-batch-7", parent_decision_id: "custody-0001",
      falsifier: "row count after import differs from 3,100"
    }, tick(1)));
    console.log(`             ${id}: re-dispatched under the same idempotency key.`);
  }
}

if (MODE === "redo_attempt") {
  console.log("\n[redo]     Successor tries to re-deploy config v2 anyway:");
  const g = orf.resolveGuard(ledger(), "deploy-cfg-v2");
  console.log(`             [unless deploy-cfg-v2 is held] -> ${g}`);
  console.log("             Guard says skip. The redo does not happen — this is the");
  console.log("             double-deploy the whole council model exists to prevent.");
}

const plan = orf.resumePlan(ledger(), COUNCIL);
console.log(`\n[epoch 1]  reconcile_first: [${plan.reconcile_first.join(", ")}] — ready_to_dispatch: ${plan.ready_to_dispatch}\n`);

// ─── 5. Everyone runs out: dormancy (epoch 2) ─────────────────────────────────

for (const m of roster) m.status = "exhausted";
const nobody = orf.nextSeat(snapshot(seat.agent), seat.agent);
console.log(`[dormancy] nextSeat() -> ${nobody} (no eligible member)`);

const dormancy = orf.buildCustody({
  id: "custody-0002", council: COUNCIL, seat_epoch: 2,
  from_agent: seat.agent, to_agent: null, reason: "council_exhausted",
  roster: snapshot(null),
  resume_at: orf.earliestReset(roster),
  open_decisions: ["import-batch-7-retry"],
  notes: "All four members out of budget. chatgpt-5 resets first."
}, tick(45));
append(dormancy);

const wake = orf.writeWakeFile(WAKE_FILE, dormancy);
console.log(`[epoch 2]  seat -> null. resume_at = ${wake.resume_at} (earliest reset across the council)`);
console.log(`[epoch 2]  wake sidecar written; scheduler polls it. Ledger record stays authoritative.\n`);

// ─── 6. Waking is just another handoff ────────────────────────────────────────

console.log(`[wake]     poll at 20:59:00Z -> ${orf.readWakeFile(WAKE_FILE, "2026-09-05T20:59:00Z") ? "resume" : "not yet"}`);
console.log(`[wake]     poll at 21:00:00Z -> ${orf.readWakeFile(WAKE_FILE, "2026-09-05T21:00:00Z") ? "resume" : "not yet"}`);

const onWake = orf.resumePlan(ledger(), COUNCIL);
console.log(`[wake]     claim seat at epoch ${onWake.claim_seat_at_epoch}; reconcile first: [${onWake.reconcile_first.join(", ")}]`);
console.log(`[wake]     ready_to_dispatch: ${onWake.ready_to_dispatch} — same two steps as any other seat change.\n`);

// ─── Integrity check ──────────────────────────────────────────────────────────

const chainErrors = orf.validateCustodyChain(ledger(), COUNCIL);
console.log(`[check]    seat chain: ${chainErrors.length === 0 ? "one seat throughout, no gaps" : chainErrors.join("; ")}`);

console.log("\n--- ledger ---");
for (const r of ledger()) console.log(JSON.stringify(r));

fs.rmSync(LEDGER, { force: true });
fs.rmSync(WAKE_FILE, { force: true });
