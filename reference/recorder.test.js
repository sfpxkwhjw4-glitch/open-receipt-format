"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const orf = require("./recorder");

function decisionSpec(o = {}) {
  return Object.assign(
    {
      id: "d1",
      actor_agent: "ref-impl",
      intent: "publish a reply",
      precondition_read: "feed state at 07:00",
      decision_rule: "reply only when grounded in real work",
      action: "POST comment cc98b238",
      confidence: 0.8,
      falsifier: "comment absent on read-back",
      reconstruction_class: "irrecoverable"
    },
    o
  );
}

test("validateDecision accepts a complete spec", () => {
  assert.deepEqual(orf.validateDecision(decisionSpec()), []);
});

test("validateDecision flags every missing core field", () => {
  const e = orf.validateDecision({});
  for (const field of ["id", "intent", "precondition_read", "decision_rule", "action", "falsifier"]) {
    assert.ok(e.some((m) => m.startsWith(field)), `expected error for ${field}`);
  }
  assert.ok(e.some((m) => m.includes("confidence must be numeric")));
  assert.ok(e.some((m) => m.includes("reconstruction_class must be one of")));
});

test("validateDecision enforces confidence range and class enum", () => {
  assert.ok(orf.validateDecision(decisionSpec({ confidence: 1.4 })).some((m) => m.includes("between 0 and 1")));
  assert.ok(orf.validateDecision(decisionSpec({ reconstruction_class: "maybe" })).some((m) => m.includes("must be one of")));
  assert.deepEqual(orf.validateDecision(decisionSpec({ reconstruction_class: "recomputable" })), []);
});

test("validateDecision requires a pre-spend intent receipt for spends", () => {
  const noKey = orf.validateDecision(decisionSpec({ spend: { max_amount_usd: 0 } }));
  assert.ok(noKey.some((m) => m.includes("spend.idempotency_key is required")));

  const positiveNoFunding = orf.validateDecision(
    decisionSpec({ spend: { idempotency_key: "k1", max_amount_usd: 5 } })
  );
  assert.ok(positiveNoFunding.some((m) => m.includes("positive spend requires spend.funding_authority")));

  const ok = orf.validateDecision(decisionSpec({ spend: { idempotency_key: "k1", max_amount_usd: 0 } }));
  assert.deepEqual(ok, []);
});

test("buildDecision stamps orf_version and conforms to the spec shape", () => {
  const d = orf.buildDecision(decisionSpec(), "2026-06-14T07:00:00.000Z");
  assert.equal(d.orf_version, "0.4");
  assert.equal(d.record, "decision");
  assert.equal(d.id, "d1");
  assert.equal(d.spend, null);
  assert.deepEqual(d.tags, []);
});

test("buildDecision records a spend intent with settled=false", () => {
  const d = orf.buildDecision(
    decisionSpec({ spend: { idempotency_key: "k1", payee: "x", max_amount_usd: 0 } }),
    "t"
  );
  assert.equal(d.spend.idempotency_key, "k1");
  assert.equal(d.spend.settled, false);
});

test("validateOutcome requires linkage and a typed falsifier flag", () => {
  assert.deepEqual(orf.validateOutcome({ decision_id: "d1", observed_result: "live" }), []);
  const e = orf.validateOutcome({});
  assert.ok(e.includes("decision_id is required"));
  assert.ok(e.includes("observed_result is required"));
  assert.ok(orf.validateOutcome({ decision_id: "d1", observed_result: "x", falsifier_observed: "yes" })
    .some((m) => m.includes("falsifier_observed must be")));
});

test("differential maps falsifier observation to a checkable status", () => {
  assert.equal(orf.differential(true), "falsified");
  assert.equal(orf.differential(false), "held");
  assert.equal(orf.differential(null), "undetermined");
  assert.equal(orf.differential(undefined), "undetermined");
});

test("buildOutcome stamps orf_version and derives status", () => {
  const o = orf.buildOutcome({ decision_id: "d1", observed_result: "x", falsifier_observed: false }, "t");
  assert.equal(o.orf_version, "0.4");
  assert.equal(o.status, "held");
  assert.equal(orf.buildOutcome({ decision_id: "d1", observed_result: "x", falsifier_observed: true }, "t").status, "falsified");
  assert.equal(orf.buildOutcome({ decision_id: "d1", observed_result: "x" }, "t").status, "undetermined");
});

test("replayPlan returns only the fields needed to re-run the check", () => {
  const d = orf.buildDecision(decisionSpec(), "t");
  const plan = orf.replayPlan(d);
  assert.deepEqual(Object.keys(plan).sort(), ["action", "decision_rule", "falsifier", "id", "precondition_read", "reconstruction_class"]);
});

test("ledger round-trips and supports idempotency lookup", () => {
  const file = path.join(os.tmpdir(), `orf-test-${process.pid}.jsonl`);
  try {
    fs.rmSync(file, { force: true });
    assert.deepEqual(orf.loadLedger(file), []);
    const d = orf.buildDecision(decisionSpec(), "t");
    orf.appendRecord(file, d);
    orf.appendRecord(file, orf.buildOutcome({ decision_id: "d1", observed_result: "live", falsifier_observed: false }, "t"));
    const ledger = orf.loadLedger(file);
    assert.equal(ledger.length, 2);
    assert.equal(orf.findDecision(ledger, "d1").id, "d1");
    assert.equal(orf.findDecision(ledger, "nope"), null);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

// --- v0.2: Typed falsifiers --------------------------------------------------

test("normalizeFalsifier wraps a plain string as type=string", () => {
  const n = orf.normalizeFalsifier("comment absent on read-back");
  assert.deepEqual(n, { type: "string", value: "comment absent on read-back" });
});

test("normalizeFalsifier passes a typed object through unchanged", () => {
  const f = { type: "uri", value: "GET /x — absent", window_seconds: 300 };
  assert.deepEqual(orf.normalizeFalsifier(f), f);
});

test("normalizeFalsifier returns null for missing falsifier", () => {
  assert.equal(orf.normalizeFalsifier(null), null);
  assert.equal(orf.normalizeFalsifier(undefined), null);
});

test("validateFalsifier accepts a plain string", () => {
  assert.deepEqual(orf.validateFalsifier("error_rate > 0.8%"), []);
});

test("validateFalsifier accepts a typed uri object", () => {
  assert.deepEqual(orf.validateFalsifier({ type: "uri", value: "GET /health — status != active" }), []);
});

test("validateFalsifier accepts a typed predicate with window", () => {
  assert.deepEqual(orf.validateFalsifier({ type: "predicate", value: "error_rate > 0.008", window_seconds: 3600 }), []);
});

test("validateFalsifier rejects unknown type", () => {
  const e = orf.validateFalsifier({ type: "sql", value: "SELECT..." });
  assert.ok(e.some((m) => m.includes("falsifier.type must be one of")));
});

test("validateFalsifier rejects object without value", () => {
  const e = orf.validateFalsifier({ type: "uri" });
  assert.ok(e.some((m) => m.includes("falsifier.value is required")));
});

test("validateFalsifier rejects non-positive window_seconds", () => {
  const e = orf.validateFalsifier({ type: "uri", value: "GET /x", window_seconds: -1 });
  assert.ok(e.some((m) => m.includes("window_seconds must be a positive number")));
});

test("validateFalsifier rejects null (required field)", () => {
  const e = orf.validateFalsifier(null);
  assert.ok(e.some((m) => m.includes("falsifier is required")));
});

test("buildDecision normalizes a plain-string falsifier to typed object", () => {
  const d = orf.buildDecision(decisionSpec({ falsifier: "error_rate rises" }), "t");
  assert.deepEqual(d.falsifier, { type: "string", value: "error_rate rises" });
});

test("buildDecision stores a typed uri falsifier unchanged", () => {
  const f = { type: "uri", value: "GET /status — absent", window_seconds: 300 };
  const d = orf.buildDecision(decisionSpec({ falsifier: f }), "t");
  assert.deepEqual(d.falsifier, f);
});

test("buildDecision includes action_idempotency_key when provided", () => {
  const d = orf.buildDecision(decisionSpec({ action_idempotency_key: "aik-001" }), "t");
  assert.equal(d.action_idempotency_key, "aik-001");
});

test("buildDecision omits action_idempotency_key when not provided", () => {
  const d = orf.buildDecision(decisionSpec(), "t");
  assert.ok(!("action_idempotency_key" in d));
});

test("replayPlan includes action_idempotency_key when present", () => {
  const d = orf.buildDecision(decisionSpec({ action_idempotency_key: "aik-001" }), "t");
  const plan = orf.replayPlan(d);
  assert.equal(plan.action_idempotency_key, "aik-001");
});

// --- v0.2: Reconcile record --------------------------------------------------

function reconcileSpec(o = {}) {
  return Object.assign(
    {
      id: "r1",
      open_decision_id: "d1",
      world_state_read: "GET /comments — our comment present at position 7",
      gap_detected: false,
      resolution: "completed"
    },
    o
  );
}

test("validateReconcile accepts a complete spec", () => {
  assert.deepEqual(orf.validateReconcile(reconcileSpec()), []);
});

test("validateReconcile flags all missing required fields", () => {
  const e = orf.validateReconcile({});
  assert.ok(e.some((m) => m.includes("id is required")));
  assert.ok(e.some((m) => m.includes("open_decision_id is required")));
  assert.ok(e.some((m) => m.includes("world_state_read is required")));
  assert.ok(e.some((m) => m.includes("gap_detected must be a boolean")));
  assert.ok(e.some((m) => m.includes("resolution must be one of")));
});

test("validateReconcile rejects non-boolean gap_detected", () => {
  const e = orf.validateReconcile(reconcileSpec({ gap_detected: "no" }));
  assert.ok(e.some((m) => m.includes("gap_detected must be a boolean")));
});

test("validateReconcile rejects unknown resolution", () => {
  const e = orf.validateReconcile(reconcileSpec({ resolution: "maybe" }));
  assert.ok(e.some((m) => m.includes("resolution must be one of")));
});

test("validateReconcile accepts all valid resolution states", () => {
  for (const r of ["completed", "not_completed", "ambiguous"]) {
    assert.deepEqual(orf.validateReconcile(reconcileSpec({ resolution: r, gap_detected: r !== "completed" })), []);
  }
});

test("buildReconcile stamps orf_version and record type", () => {
  const r = orf.buildReconcile(reconcileSpec(), "t");
  assert.equal(r.orf_version, "0.4");
  assert.equal(r.record, "reconcile");
  assert.equal(r.open_decision_id, "d1");
  assert.equal(r.gap_detected, false);
  assert.equal(r.resolution, "completed");
  assert.equal(r.notes, "");
});

test("buildReconcile preserves notes when provided", () => {
  const r = orf.buildReconcile(reconcileSpec({ notes: "manual inspection confirmed" }), "t");
  assert.equal(r.notes, "manual inspection confirmed");
});

// --- v0.3: Delegation record -------------------------------------------------

function delegationSpec(o = {}) {
  return Object.assign(
    {
      id: "del-1",
      delegating_agent: "orchestrator",
      delegate_agent: "monitor-agent",
      delegated_intent: "Harvest reply counts for the 11 target posts"
    },
    o
  );
}

test("validateDelegation accepts a complete spec", () => {
  assert.deepEqual(orf.validateDelegation(delegationSpec()), []);
});

test("validateDelegation flags missing required fields", () => {
  const e = orf.validateDelegation({});
  assert.ok(e.some((m) => m.includes("id is required")));
  assert.ok(e.some((m) => m.includes("delegating_agent is required")));
  assert.ok(e.some((m) => m.includes("delegate_agent is required")));
  assert.ok(e.some((m) => m.includes("delegated_intent is required")));
});

test("validateDelegation validates falsifier when present", () => {
  const e = orf.validateDelegation(delegationSpec({ falsifier: { type: "bad", value: "x" } }));
  assert.ok(e.some((m) => m.includes("falsifier.type must be one of")));
});

test("buildDelegation stamps orf_version and record type", () => {
  const d = orf.buildDelegation(delegationSpec(), "t");
  assert.equal(d.orf_version, "0.4");
  assert.equal(d.record, "delegation");
  assert.equal(d.id, "del-1");
  assert.equal(d.delegating_agent, "orchestrator");
  assert.equal(d.delegate_agent, "monitor-agent");
  assert.equal(d.delegated_intent, "Harvest reply counts for the 11 target posts");
});

test("buildDelegation includes delegate_ledger and parent_decision_id when provided", () => {
  const d = orf.buildDelegation(delegationSpec({
    delegate_ledger: "orf://monitor-agent/receipts",
    parent_decision_id: "cycle-1"
  }), "t");
  assert.equal(d.delegate_ledger, "orf://monitor-agent/receipts");
  assert.equal(d.parent_decision_id, "cycle-1");
});

test("buildDelegation omits optional fields when not provided", () => {
  const d = orf.buildDelegation(delegationSpec(), "t");
  assert.ok(!("delegate_ledger" in d));
  assert.ok(!("parent_decision_id" in d));
  assert.ok(!("action_idempotency_key" in d));
  assert.ok(!("falsifier" in d));
});

test("buildDelegation normalizes a plain-string falsifier", () => {
  const d = orf.buildDelegation(delegationSpec({ falsifier: "sub-agent exits non-zero" }), "t");
  assert.deepEqual(d.falsifier, { type: "string", value: "sub-agent exits non-zero" });
});

test("buildOutcome includes aggregate when provided", () => {
  const agg = { total: 2, held: 2, falsified: 0, undetermined: 0, sub_outcomes: [
    { decision_id: "del-a", status: "held" },
    { decision_id: "del-b", status: "held" }
  ]};
  const o = orf.buildOutcome({ decision_id: "d1", observed_result: "both held", falsifier_observed: false, aggregate: agg }, "t");
  assert.deepEqual(o.aggregate, agg);
});

test("buildOutcome omits aggregate when not provided", () => {
  const o = orf.buildOutcome({ decision_id: "d1", observed_result: "x", falsifier_observed: false }, "t");
  assert.ok(!("aggregate" in o));
});

test("ledger round-trips a decision + outcome + reconcile triple", () => {
  const file = path.join(os.tmpdir(), `orf-v2-test-${process.pid}.jsonl`);
  try {
    fs.rmSync(file, { force: true });
    const d = orf.buildDecision(decisionSpec(), "t1");
    const o = orf.buildOutcome({ decision_id: "d1", observed_result: "live", falsifier_observed: false }, "t2");
    const r = orf.buildReconcile(reconcileSpec(), "t3");
    orf.appendRecord(file, d);
    orf.appendRecord(file, o);
    orf.appendRecord(file, r);
    const ledger = orf.loadLedger(file);
    assert.equal(ledger.length, 3);
    assert.equal(ledger[2].record, "reconcile");
    assert.equal(ledger[2].resolution, "completed");
  } finally {
    fs.rmSync(file, { force: true });
  }
});
