"use strict";
// Example: async batch orchestrator with ORF v0.9 checkpoint pattern.
//
// Shows the streaming/async aggregation pattern: an orchestrator dispatches N
// sub-agents in parallel, writes checkpoint outcomes (status: "in_progress",
// aggregate.pending > 0) as results arrive, and writes a final aggregate record
// once all are resolved.
//
// Key rules:
//   - "in_progress" is NOT a final status — it records progress, not the verdict.
//   - A checkpoint MUST have aggregate.pending > 0.
//   - The single record with status != "in_progress" is the authoritative outcome.
//   - Multiple outcome records for the same decision_id are valid; checkpoint
//     records provide audit trail and crash-recovery visibility.
//   - Total invariant: held + falsified + undetermined + partial + pending == total
//
// Run: node examples/async-batch-agent.js [all_held|one_falsified]
// Default: all_held

const orf = require("../reference/helper");
const fs = require("fs");
const os = require("os");
const path = require("path");

const LEDGER = path.join(os.tmpdir(), "orf-async-batch-example.jsonl");
const AGENT = "import-orchestrator-v2";
const DECISION_ID = `batch-import-${Date.now()}`;
const MODE = process.argv[2] || "all_held";

// ─── Simulated sub-agents ─────────────────────────────────────────────────────
// In a real system, these would be concurrent calls returning promises.

const SUB_AGENTS = [
  { id: "import-A", records: 2400 },
  { id: "import-B", records: 1800 },
  { id: "import-C", records: 3100 },
];

function simulateSubAgent(agent) {
  if (MODE === "one_falsified" && agent.id === "import-B") {
    return { id: agent.id, ok: false, error: "SCHEMA_ERROR: 14 records failed validation" };
  }
  return { id: agent.id, ok: true, records: agent.records };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emit(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

function loadLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
// Write the orchestrator's decision before dispatching sub-agents.
// resolution_policy declares how the aggregate will be interpreted.

fs.rmSync(LEDGER, { force: true });

const dec = emit(
  LEDGER,
  orf.decision(DECISION_ID, {
    actor: AGENT,
    intent: `Run ${SUB_AGENTS.length} import sub-agents in parallel and aggregate results`,
    precondition: `import queue: ${SUB_AGENTS.length} jobs pending (${SUB_AGENTS.map((a) => a.id).join(", ")})`,
    rule: "dispatch all available import jobs; aggregate with any_falsified_is_failure",
    action: `dispatch ${SUB_AGENTS.map((a) => a.id).join(", ")}`,
    falsifier: "any sub-agent exits with non-zero status",
    confidence: 0.9,
    reconClass: "recomputable",
    resolutionPolicy: "any_falsified_is_failure",
  })
);
console.log(`[dispatch] ${dec.id} — dispatching ${SUB_AGENTS.length} sub-agents\n`);

// ─── Aggregate as results arrive ──────────────────────────────────────────────
// In a real orchestrator this would be an event loop or Promise.all with
// intermediate .then() callbacks. Here we simulate sequential arrival.
//
// Crash-recovery note: if the orchestrator stops mid-run, the last checkpoint
// record in the ledger shows exactly where things stood — which sub-agents
// resolved, which are still pending, and whether any failures had already arrived.

const resolved = [];

for (const agent of SUB_AGENTS) {
  const result = simulateSubAgent(agent);
  resolved.push(result);

  const pending = SUB_AGENTS.length - resolved.length;
  const isFinal = pending === 0;
  const held = resolved.filter((r) => r.ok).length;
  const falsified = resolved.filter((r) => !r.ok).length;

  const aggregate = {
    total: SUB_AGENTS.length,
    held,
    falsified,
    undetermined: 0,
    partial: 0,
    pending,
    resolution_policy: "any_falsified_is_failure",
    sub_outcomes: resolved.map((r) => ({
      decision_id: `${DECISION_ID}::${r.id}`,
      status: r.ok ? "held" : "falsified",
      notes: r.ok ? `${r.records} records imported` : r.error,
    })),
  };

  if (!isFinal) {
    // Checkpoint: in_progress with pending > 0.
    // These records are NOT authoritative — they record progress only.
    emit(
      LEDGER,
      orf.outcome(DECISION_ID, {
        observedResult: `checkpoint: ${resolved.length} of ${SUB_AGENTS.length} resolved; ${pending} still running`,
        falsifierObserved: null,
        status: "in_progress",
        aggregate,
      })
    );
    console.log(`[checkpoint] ${agent.id} resolved — ${pending} still pending`);
  } else {
    // Final record: status determined by resolution_policy.
    // Under any_falsified_is_failure: one falsified → the whole batch is falsified.
    const finalStatus = falsified > 0 ? "falsified" : "held";
    emit(
      LEDGER,
      orf.outcome(DECISION_ID, {
        observedResult: `batch complete: ${held} held, ${falsified} falsified of ${SUB_AGENTS.length} total`,
        falsifierObserved: falsified > 0,
        status: finalStatus,
        notes:
          falsified > 0
            ? `Failure under any_falsified_is_failure: ${falsified} sub-agent(s) exited with error`
            : undefined,
        aggregate,
      })
    );
    console.log(
      `[final]      ${agent.id} resolved — batch status=${finalStatus} (${held} held, ${falsified} falsified)\n`
    );
  }
}

// ─── Show the ledger ──────────────────────────────────────────────────────────
console.log("--- ledger ---");
for (const r of loadLedger(LEDGER)) {
  console.log(JSON.stringify(r, null, 2));
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(LEDGER, { force: true });
