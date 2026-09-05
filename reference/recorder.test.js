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
  assert.equal(d.orf_version, "0.10");
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
  assert.equal(o.orf_version, "0.10");
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
  assert.equal(r.orf_version, "0.10");
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
  assert.equal(d.orf_version, "0.10");
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

// --- v0.7: outcome.notes field -----------------------------------------------

test("buildOutcome passes through notes when provided", () => {
  const o = orf.buildOutcome({ decision_id: "d1", observed_result: "x", notes: "policy diverged — declared any_falsified_is_failure, aggregator used majority_held_is_success" }, "t");
  assert.equal(o.notes, "policy diverged — declared any_falsified_is_failure, aggregator used majority_held_is_success");
});

test("buildOutcome omits notes when not provided", () => {
  const o = orf.buildOutcome({ decision_id: "d1", observed_result: "x" }, "t");
  assert.ok(!("notes" in o));
});

// --- v0.9: in_progress status and aggregate.pending --------------------------

test("OUTCOME_STATES includes in_progress", () => {
  assert.ok(orf.OUTCOME_STATES.includes("in_progress"));
});

test("validateOutcome accepts in_progress with aggregate.pending > 0", () => {
  const e = orf.validateOutcome({
    decision_id: "d1", observed_result: "5 of 10 done",
    status: "in_progress",
    aggregate: { total: 10, held: 3, falsified: 0, undetermined: 2, partial: 0, pending: 5, sub_outcomes: [] }
  });
  assert.deepEqual(e, []);
});

test("validateOutcome rejects in_progress without aggregate", () => {
  const e = orf.validateOutcome({ decision_id: "d1", observed_result: "x", status: "in_progress" });
  assert.ok(e.some((m) => m.includes("in_progress") && m.includes("aggregate is absent")));
});

test("validateOutcome rejects in_progress when aggregate.pending is 0", () => {
  const e = orf.validateOutcome({
    decision_id: "d1", observed_result: "x",
    status: "in_progress",
    aggregate: { total: 5, held: 5, falsified: 0, undetermined: 0, pending: 0, sub_outcomes: [] }
  });
  assert.ok(e.some((m) => m.includes("in_progress") && m.includes("pending")));
});

test("validateOutcome rejects aggregate.pending > 0 without in_progress status", () => {
  const e = orf.validateOutcome({
    decision_id: "d1", observed_result: "x",
    status: "held",
    aggregate: { total: 10, held: 7, falsified: 0, undetermined: 0, partial: 0, pending: 3, sub_outcomes: [] }
  });
  assert.ok(e.some((m) => m.includes("pending") && m.includes("in_progress")));
});

test("validateOutcome rejects aggregate.pending that is not a non-negative integer", () => {
  const e = orf.validateOutcome({
    decision_id: "d1", observed_result: "x",
    aggregate: { total: 5, held: 4, falsified: 0, undetermined: 0, pending: -1, sub_outcomes: [] }
  });
  assert.ok(e.some((m) => m.includes("aggregate.pending must be a non-negative integer")));
});

test("buildOutcome accepts in_progress with aggregate containing pending", () => {
  const agg = { total: 10, held: 3, falsified: 0, undetermined: 2, partial: 0, pending: 5, sub_outcomes: [] };
  const o = orf.buildOutcome({ decision_id: "d1", observed_result: "checkpoint", status: "in_progress", aggregate: agg }, "t");
  assert.equal(o.status, "in_progress");
  assert.deepEqual(o.aggregate, agg);
});

// --- v0.10: custody records, the seat, and guards -----------------------------

function custodySpec(o = {}) {
  return Object.assign(
    {
      id: "custody-1",
      council: "test-council",
      seat_epoch: 1,
      from_agent: "agent-a",
      to_agent: "agent-b",
      reason: "budget_low"
    },
    o
  );
}

test("validateCustody accepts a complete handoff spec", () => {
  assert.deepEqual(orf.validateCustody(custodySpec()), []);
});

test("validateCustody accepts an epoch-0 claim with null from_agent", () => {
  const e = orf.validateCustody(custodySpec({ seat_epoch: 0, from_agent: null, reason: "seat_claimed" }));
  assert.deepEqual(e, []);
});

test("validateCustody rejects an unknown reason", () => {
  const e = orf.validateCustody(custodySpec({ reason: "felt_like_it" }));
  assert.ok(e.some((m) => m.includes("reason must be one of")));
});

test("validateCustody rejects a negative or non-integer seat_epoch", () => {
  assert.ok(orf.validateCustody(custodySpec({ seat_epoch: -1 })).some((m) => m.includes("seat_epoch")));
  assert.ok(orf.validateCustody(custodySpec({ seat_epoch: 1.5 })).some((m) => m.includes("seat_epoch")));
});

test("validateCustody rejects a handoff that does not move the seat", () => {
  const e = orf.validateCustody(custodySpec({ from_agent: "agent-a", to_agent: "agent-a" }));
  assert.ok(e.some((m) => m.includes("to_agent must differ from from_agent")));
});

test("validateCustody rejects dormancy without resume_at", () => {
  const e = orf.validateCustody(custodySpec({ to_agent: null, reason: "council_exhausted" }));
  assert.ok(e.some((m) => m.includes("resume_at is absent")));
});

test("validateCustody rejects a null to_agent with a non-exhaustion reason", () => {
  const e = orf.validateCustody(custodySpec({ to_agent: null, reason: "voluntary", resume_at: "2026-01-01T00:00:00Z" }));
  assert.ok(e.some((m) => m.includes("council_exhausted")));
});

test("validateCustody accepts a well-formed dormancy record", () => {
  const e = orf.validateCustody(
    custodySpec({ to_agent: null, reason: "council_exhausted", resume_at: "2026-01-01T00:00:00Z" })
  );
  assert.deepEqual(e, []);
});

test("validateCustody rejects an out-of-range budget.remaining_fraction", () => {
  const e = orf.validateCustody(custodySpec({ budget: { remaining_fraction: 1.4 } }));
  assert.ok(e.some((m) => m.includes("budget.remaining_fraction")));
});

test("validateCustody rejects an unknown roster role or status", () => {
  assert.ok(
    orf.validateCustody(custodySpec({ roster: [{ agent: "x", role: "boss" }] })).some((m) => m.includes("role must be one of"))
  );
  assert.ok(
    orf.validateCustody(custodySpec({ roster: [{ agent: "x", status: "sleepy" }] })).some((m) => m.includes("status must be one of"))
  );
});

test("buildCustody emits v0.10 and carries optional fields through", () => {
  const r = orf.buildCustody(
    custodySpec({ open_decisions: ["d1", "orf://other/d2"], notes: "n", falsifier: "no successor within 300s" }),
    "2026-01-01T00:00:00Z"
  );
  assert.equal(r.orf_version, "0.10");
  assert.equal(r.record, "custody");
  assert.deepEqual(r.open_decisions, ["d1", "orf://other/d2"]);
  assert.deepEqual(r.falsifier, { type: "string", value: "no successor within 300s" });
});

test("buildCustody omits absent optional fields", () => {
  const r = orf.buildCustody(custodySpec(), "t");
  for (const k of ["budget", "roster", "open_decisions", "resume_at", "handoff_ledger", "notes", "falsifier"]) {
    assert.ok(!(k in r), `expected ${k} to be absent`);
  }
});

// --- the seat ----------------------------------------------------------------

const seatLedger = [
  orf.buildCustody({ id: "c0", council: "k", seat_epoch: 0, from_agent: null, to_agent: "a", reason: "seat_claimed" }, "t0"),
  orf.buildCustody({ id: "c1", council: "k", seat_epoch: 1, from_agent: "a", to_agent: "b", reason: "budget_low" }, "t1")
];

test("currentSeat returns the highest-epoch holder", () => {
  const seat = orf.currentSeat(seatLedger, "k");
  assert.equal(seat.agent, "b");
  assert.equal(seat.seat_epoch, 1);
});

test("currentSeat returns null for a council with no custody records", () => {
  assert.equal(orf.currentSeat(seatLedger, "other-council"), null);
});

test("currentSeat ignores a duplicate epoch — the first appended wins", () => {
  const contested = seatLedger.concat([
    orf.buildCustody({ id: "c1-dup", council: "k", seat_epoch: 1, from_agent: "a", to_agent: "c", reason: "unresponsive" }, "t2")
  ]);
  assert.equal(orf.currentSeat(contested, "k").agent, "b", "the second claimant at epoch 1 must not take the seat");
});

test("validateCustodyChain accepts a contiguous chain from epoch 0", () => {
  assert.deepEqual(orf.validateCustodyChain(seatLedger, "k"), []);
});

test("validateCustodyChain reports a gap in the epoch sequence", () => {
  const gapped = seatLedger.concat([
    orf.buildCustody({ id: "c3", council: "k", seat_epoch: 3, from_agent: "b", to_agent: "a", reason: "voluntary" }, "t3")
  ]);
  assert.ok(orf.validateCustodyChain(gapped, "k").some((m) => m.includes("seat_epoch gap: expected 2")));
});

test("validateCustodyChain reports a duplicate epoch", () => {
  const contested = seatLedger.concat([
    orf.buildCustody({ id: "c1-dup", council: "k", seat_epoch: 1, from_agent: "a", to_agent: "c", reason: "unresponsive" }, "t2")
  ]);
  assert.ok(orf.validateCustodyChain(contested, "k").some((m) => m.includes("duplicate custody record at seat_epoch 1")));
});

// --- deterministic succession ------------------------------------------------

const roster = [
  { agent: "chatgpt-5", role: "hand", status: "available", remaining_fraction: 0.31, resets_at: "2026-09-05T21:00:00Z" },
  { agent: "claude-opus-5", role: "hand", status: "available", remaining_fraction: 0.91, resets_at: "2026-09-05T22:30:00Z" },
  { agent: "gemini-3.8-flash", role: "hand", status: "available", remaining_fraction: 0.74, resets_at: "2026-09-05T23:15:00Z" },
  { agent: "grok-4.6", role: "hand", status: "onboarding", remaining_fraction: 1.0, resets_at: "2026-09-06T00:05:00Z" }
];

test("nextSeat picks the greatest remaining_fraction among eligible members", () => {
  assert.equal(orf.nextSeat(roster, "chatgpt-5"), "claude-opus-5");
});

test("nextSeat excludes onboarding members even at full budget", () => {
  assert.notEqual(orf.nextSeat(roster, "chatgpt-5"), "grok-4.6");
});

test("nextSeat excludes observers, the outgoing holder, and unreachable members", () => {
  const r = [
    { agent: "obs", role: "observer", status: "available", remaining_fraction: 1.0 },
    { agent: "out", role: "hand", status: "available", remaining_fraction: 0.99 },
    { agent: "gone", role: "hand", status: "unreachable", remaining_fraction: 0.98 },
    { agent: "in", role: "hand", status: "available", remaining_fraction: 0.5 }
  ];
  assert.equal(orf.nextSeat(r, "out"), "in");
});

test("nextSeat breaks a budget tie by earliest resets_at, then by agent id", () => {
  const tie = [
    { agent: "zeta", role: "hand", status: "available", remaining_fraction: 0.5, resets_at: "2026-09-05T20:00:00Z" },
    { agent: "beta", role: "hand", status: "available", remaining_fraction: 0.5, resets_at: "2026-09-05T22:00:00Z" }
  ];
  assert.equal(orf.nextSeat(tie, "x"), "zeta", "earliest resets_at wins the budget tie");

  const fullTie = [
    { agent: "zeta", role: "hand", status: "available", remaining_fraction: 0.5, resets_at: "2026-09-05T20:00:00Z" },
    { agent: "beta", role: "hand", status: "available", remaining_fraction: 0.5, resets_at: "2026-09-05T20:00:00Z" }
  ];
  assert.equal(orf.nextSeat(fullTie, "x"), "beta", "smallest agent id breaks a full tie");
});

test("nextSeat is deterministic regardless of roster order", () => {
  const shuffled = roster.slice().reverse();
  assert.equal(orf.nextSeat(shuffled, "chatgpt-5"), orf.nextSeat(roster, "chatgpt-5"));
});

test("nextSeat returns null when no member is eligible — the dormancy signal", () => {
  const spent = roster.map((m) => Object.assign({}, m, { status: "exhausted" }));
  assert.equal(orf.nextSeat(spent, "chatgpt-5"), null);
});

test("earliestReset returns the first reset among exhausted members", () => {
  const spent = roster.map((m) => Object.assign({}, m, { status: "exhausted" }));
  assert.equal(orf.earliestReset(spent), "2026-09-05T21:00:00Z");
});

test("earliestReset ignores members that are not exhausted", () => {
  assert.equal(orf.earliestReset(roster), null);
});

// --- guards ------------------------------------------------------------------

const guardLedger = [
  orf.buildDecision(decisionSpec({ id: "done", action_idempotency_key: "key-done" }), "t"),
  orf.buildOutcome({ decision_id: "done", observed_result: "landed", falsifier_observed: false }, "t"),
  orf.buildDecision(decisionSpec({ id: "open" }), "t"),
  orf.buildDecision(decisionSpec({ id: "checkpointed" }), "t"),
  orf.buildOutcome(
    {
      decision_id: "checkpointed",
      observed_result: "2 of 5 in",
      status: "in_progress",
      aggregate: { total: 5, held: 2, falsified: 0, undetermined: 0, pending: 3, sub_outcomes: [] }
    },
    "t"
  ),
  orf.buildDecision(decisionSpec({ id: "failed" }), "t"),
  orf.buildOutcome({ decision_id: "failed", observed_result: "error rate spiked", falsifier_observed: true }, "t")
];

test("resolveGuard says skip when the step is already held", () => {
  assert.equal(orf.resolveGuard(guardLedger, "done"), "skip");
});

test("resolveGuard resolves an orf:// URI and an idempotency key to the same answer", () => {
  assert.equal(orf.resolveGuard(guardLedger, "orf://some-ledger/done"), "skip");
  assert.equal(orf.resolveGuard(guardLedger, "key-done"), "skip");
});

test("resolveGuard says execute when no receipt for the step exists", () => {
  assert.equal(orf.resolveGuard(guardLedger, "never-started"), "execute");
});

test("resolveGuard says reconcile for a decision nothing closed — the crash gap", () => {
  assert.equal(orf.resolveGuard(guardLedger, "open"), "reconcile");
});

test("resolveGuard says reconcile for an in_progress checkpoint, never skip", () => {
  assert.equal(orf.resolveGuard(guardLedger, "checkpointed"), "reconcile");
});

test("resolveGuard says reconcile for a falsified step — not already done, not blindly re-run", () => {
  assert.equal(orf.resolveGuard(guardLedger, "failed"), "reconcile");
});

test("resolveGuard reuses an existing reconcile answer instead of asking again", () => {
  const withCompleted = guardLedger.concat([
    orf.buildReconcile(
      { id: "r1", open_decision_id: "open", world_state_read: "already applied", gap_detected: false, resolution: "completed" },
      "t"
    )
  ]);
  assert.equal(orf.resolveGuard(withCompleted, "open"), "skip");

  const withNotCompleted = guardLedger.concat([
    orf.buildReconcile(
      { id: "r2", open_decision_id: "open", world_state_read: "nothing applied", gap_detected: true, resolution: "not_completed" },
      "t"
    )
  ]);
  assert.equal(orf.resolveGuard(withNotCompleted, "open"), "execute");
});

test("resolveGuard leaves an ambiguous reconcile unresolved rather than guessing", () => {
  const ambiguous = guardLedger.concat([
    orf.buildReconcile(
      { id: "r3", open_decision_id: "open", world_state_read: "message may have been consumed", gap_detected: true, resolution: "ambiguous" },
      "t"
    )
  ]);
  assert.equal(orf.resolveGuard(ambiguous, "open"), "reconcile");
});

test("resolveGuard honours a non-default expected status", () => {
  assert.equal(orf.resolveGuard(guardLedger, "failed", "falsified"), "skip");
});

// --- inheritance and resume ---------------------------------------------------

const handoff = orf.buildCustody(
  {
    id: "c1", council: "k", seat_epoch: 1, from_agent: "a", to_agent: "b",
    reason: "budget_low", open_decisions: ["done", "orf://k/open"]
  },
  "t"
);

test("unreconciled lists every inherited decision the successor has not closed", () => {
  assert.deepEqual(orf.unreconciled(guardLedger, handoff), ["done", "orf://k/open"]);
});

test("unreconciled matches a reconcile written against the bare id of an orf:// entry", () => {
  const led = guardLedger.concat([
    orf.buildReconcile({ id: "r", open_decision_id: "open", world_state_read: "w", gap_detected: false, resolution: "completed" }, "t")
  ]);
  assert.deepEqual(orf.unreconciled(led, handoff), ["done"]);
});

test("unreconciled returns an empty list when there is nothing to inherit", () => {
  assert.deepEqual(orf.unreconciled(guardLedger, orf.buildCustody(custodySpec(), "t")), []);
});

test("resumePlan withholds dispatch until every inherited decision is reconciled", () => {
  const led = [seatLedger[0], handoff].concat(guardLedger);
  const plan = orf.resumePlan(led, "k");
  assert.equal(plan.claim_seat_at_epoch, 2);
  assert.equal(plan.ready_to_dispatch, false);
  assert.deepEqual(plan.reconcile_first, ["done", "orf://k/open"]);
});

test("resumePlan on an empty ledger starts at epoch 0 with nothing to reconcile", () => {
  const plan = orf.resumePlan([], "k");
  assert.equal(plan.claim_seat_at_epoch, 0);
  assert.equal(plan.ready_to_dispatch, true);
});

// --- dormancy and wake --------------------------------------------------------

const dormancy = orf.buildCustody(
  {
    id: "c9", council: "k", seat_epoch: 9, from_agent: "d", to_agent: null,
    reason: "council_exhausted", resume_at: "2026-09-05T21:00:00Z",
    open_decisions: ["open"],
    roster: [{ agent: "a", status: "exhausted", resets_at: "2026-09-05T21:00:00Z" }]
  },
  "t"
);

test("writeWakeFile mirrors the dormancy record and names the next epoch to claim", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orf-wake-")), "wake.json");
  const wake = orf.writeWakeFile(f, dormancy);
  assert.equal(wake.resume_at, "2026-09-05T21:00:00Z");
  assert.equal(wake.claim_seat_at_epoch, 10);
  assert.equal(wake.dormancy_record_id, "c9");
  assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), wake);
});

test("writeWakeFile refuses a record that is not a dormancy record", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orf-wake-")), "wake.json");
  assert.throws(() => orf.writeWakeFile(f, handoff), /dormancy record/);
});

test("readWakeFile returns null before resume_at and the payload at or after it", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orf-wake-")), "wake.json");
  orf.writeWakeFile(f, dormancy);
  assert.equal(orf.readWakeFile(f, "2026-09-05T20:59:59Z"), null);
  assert.ok(orf.readWakeFile(f, "2026-09-05T21:00:00Z"));
  assert.ok(orf.readWakeFile(f, "2026-09-06T00:00:00Z"));
});

test("readWakeFile returns null when no wake file exists", () => {
  assert.equal(orf.readWakeFile(path.join(os.tmpdir(), "orf-no-such-wake-file.json")), null);
});

test("a custody record round-trips through an append-only ledger", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orf-custody-"));
  const file = path.join(dir, "ledger.jsonl");
  orf.appendRecord(file, orf.buildCustody(custodySpec({ seat_epoch: 0, from_agent: null, reason: "seat_claimed" }), "t0"));
  orf.appendRecord(file, orf.buildCustody(custodySpec(), "t1"));
  const led = orf.loadLedger(file);
  assert.equal(led.length, 2);
  assert.equal(orf.currentSeat(led, "test-council").agent, "agent-b");
  assert.deepEqual(orf.validateCustodyChain(led, "test-council"), []);
});
