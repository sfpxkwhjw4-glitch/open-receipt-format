"use strict";
// ORF v0.2 conformance suite.
//
// This file self-certifies the reference implementation, but it also shows
// the pattern for certifying YOUR implementation:
//
//   1. Build records using your implementation (any language).
//   2. Serialize them to JSON.
//   3. Pass each to the matching validateXxxRecord() function.
//   4. Assert errors is empty — that is conformance.
//
// The validators check the JSON output shape, not the builder functions.
// A Python or Go implementation produces the same JSON and passes the same checks.
//
// Usage with the reference implementation:
//   node --test conformance/orf.conformance.test.js
//
// Usage with your own records (Node):
//   const { validateRecord } = require("./conformance/validate");
//   const errors = validateRecord(myRecord);
//   assert.deepEqual(errors, []);

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateFalsifier,
  validateAggregate,
  validateDecisionRecord,
  validateReconcileRecord,
  validateOutcomeRecord,
  validateDelegationRecord,
  validateCustodyRecord,
  validateCustodyChain,
  validateRecord
} = require("./validate");
const orf = require("../reference/recorder");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decisionSpec(o = {}) {
  return Object.assign(
    {
      id: "conf-d1",
      actor_agent: "conformance-agent",
      intent: "write test config",
      precondition_read: "version=1",
      decision_rule: "write when version < 2",
      action: "write config v2",
      confidence: 0.85,
      falsifier: { type: "uri", value: "GET /config — version != 2", window_seconds: 600 },
      reconstruction_class: "irrecoverable"
    },
    o
  );
}

function reconcileSpec(o = {}) {
  return Object.assign(
    {
      id: "conf-r1",
      open_decision_id: "conf-d1",
      world_state_read: "GET /config status=200 version=2",
      gap_detected: false,
      resolution: "completed"
    },
    o
  );
}

// ─── validateFalsifier ────────────────────────────────────────────────────────

test("conformance: plain-string falsifier is valid (v0.1 compat)", () => {
  assert.deepEqual(validateFalsifier("error_rate spikes above 0.8%"), []);
});

test("conformance: uri falsifier with window is valid", () => {
  assert.deepEqual(
    validateFalsifier({ type: "uri", value: "GET /health — status != active", window_seconds: 300 }),
    []
  );
});

test("conformance: predicate falsifier without window is valid", () => {
  assert.deepEqual(validateFalsifier({ type: "predicate", value: "error_rate(1h) > 0.008" }), []);
});

test("conformance: string-type typed falsifier is valid", () => {
  assert.deepEqual(validateFalsifier({ type: "string", value: "comment absent on read-back" }), []);
});

test("conformance: unknown falsifier type is invalid", () => {
  const e = validateFalsifier({ type: "sql", value: "SELECT..." });
  assert.ok(e.some((m) => m.includes("falsifier.type must be one of")));
});

test("conformance: missing falsifier.value is invalid", () => {
  const e = validateFalsifier({ type: "uri" });
  assert.ok(e.some((m) => m.includes("falsifier.value is required")));
});

test("conformance: non-positive window_seconds is invalid", () => {
  const e = validateFalsifier({ type: "uri", value: "GET /x", window_seconds: 0 });
  assert.ok(e.some((m) => m.includes("window_seconds must be a positive number")));
});

test("conformance: null falsifier is invalid", () => {
  const e = validateFalsifier(null);
  assert.ok(e.some((m) => m.includes("falsifier is required")));
});

// ─── decision record ──────────────────────────────────────────────────────────

test("conformance: reference buildDecision produces a conforming record", () => {
  const d = orf.buildDecision(decisionSpec(), new Date().toISOString());
  assert.deepEqual(validateDecisionRecord(d), []);
});

test("conformance: decision record missing id is invalid", () => {
  const d = orf.buildDecision(decisionSpec(), "t");
  delete d.id;
  const e = validateDecisionRecord(d);
  assert.ok(e.some((m) => m.includes("id is required")));
});

test("conformance: decision record with out-of-range confidence is invalid", () => {
  const d = orf.buildDecision(decisionSpec({ confidence: 1.5 }), "t");
  d.confidence = 1.5;
  const e = validateDecisionRecord(d);
  assert.ok(e.some((m) => m.includes("confidence must be a number between 0 and 1")));
});

test("conformance: decision record with invalid reconstruction_class is invalid", () => {
  const d = orf.buildDecision(decisionSpec({ reconstruction_class: "maybe" }), "t");
  d.reconstruction_class = "maybe";
  const e = validateDecisionRecord(d);
  assert.ok(e.some((m) => m.includes("reconstruction_class must be one of")));
});

test("conformance: decision record with action_idempotency_key is valid", () => {
  const d = orf.buildDecision(decisionSpec({ action_idempotency_key: "deploy-v2" }), "t");
  assert.deepEqual(validateDecisionRecord(d), []);
});

test("conformance: decision record with plain-string falsifier is valid (v0.1 compat)", () => {
  const d = orf.buildDecision(decisionSpec({ falsifier: "error rate spikes" }), "t");
  assert.deepEqual(validateDecisionRecord(d), []);
});

// ─── reconcile record ─────────────────────────────────────────────────────────

test("conformance: reference buildReconcile produces a conforming record", () => {
  const r = orf.buildReconcile(reconcileSpec(), new Date().toISOString());
  assert.deepEqual(validateReconcileRecord(r), []);
});

test("conformance: reconcile record missing world_state_read is invalid", () => {
  const r = orf.buildReconcile(reconcileSpec(), "t");
  delete r.world_state_read;
  const e = validateReconcileRecord(r);
  assert.ok(e.some((m) => m.includes("world_state_read is required")));
});

test("conformance: reconcile record with non-boolean gap_detected is invalid", () => {
  const r = orf.buildReconcile(reconcileSpec(), "t");
  r.gap_detected = "no";
  const e = validateReconcileRecord(r);
  assert.ok(e.some((m) => m.includes("gap_detected must be a boolean")));
});

test("conformance: reconcile all three resolution states are valid", () => {
  for (const res of ["completed", "not_completed", "ambiguous"]) {
    const r = orf.buildReconcile(reconcileSpec({ resolution: res }), "t");
    assert.deepEqual(validateReconcileRecord(r), [], `resolution=${res} should be valid`);
  }
});

// ─── outcome record ───────────────────────────────────────────────────────────

test("conformance: reference buildOutcome produces a conforming record (held)", () => {
  const o = orf.buildOutcome(
    { decision_id: "conf-d1", observed_result: "version=2 confirmed", falsifier_observed: false },
    new Date().toISOString()
  );
  assert.deepEqual(validateOutcomeRecord(o), []);
  assert.equal(o.status, "held");
});

test("conformance: reference buildOutcome produces a conforming record (falsified)", () => {
  const o = orf.buildOutcome(
    { decision_id: "conf-d1", observed_result: "version still 1", falsifier_observed: true },
    new Date().toISOString()
  );
  assert.deepEqual(validateOutcomeRecord(o), []);
  assert.equal(o.status, "falsified");
});

test("conformance: reference buildOutcome produces a conforming record (undetermined)", () => {
  const o = orf.buildOutcome(
    { decision_id: "conf-d1", observed_result: "endpoint unreachable" },
    new Date().toISOString()
  );
  assert.deepEqual(validateOutcomeRecord(o), []);
  assert.equal(o.status, "undetermined");
});

test("conformance: outcome record with invalid falsifier_observed is invalid", () => {
  const o = orf.buildOutcome({ decision_id: "conf-d1", observed_result: "x", falsifier_observed: false }, "t");
  o.falsifier_observed = "no";
  const e = validateOutcomeRecord(o);
  assert.ok(e.some((m) => m.includes("falsifier_observed must be true, false, or null")));
});

// ─── validateRecord dispatch ──────────────────────────────────────────────────

test("conformance: validateRecord dispatches to the correct validator", () => {
  const d = orf.buildDecision(decisionSpec(), "t");
  const r = orf.buildReconcile(reconcileSpec(), "t");
  const o = orf.buildOutcome({ decision_id: "conf-d1", observed_result: "x", falsifier_observed: false }, "t");
  const del = orf.buildDelegation({ id: "del-1", delegating_agent: "orch", delegate_agent: "sub", delegated_intent: "do x" }, "t");
  assert.deepEqual(validateRecord(d), []);
  assert.deepEqual(validateRecord(r), []);
  assert.deepEqual(validateRecord(o), []);
  assert.deepEqual(validateRecord(del), []);
});

test("conformance: validateRecord rejects unknown record type", () => {
  const e = validateRecord({ record: "audit", orf_version: "0.3" });
  assert.ok(e.some((m) => m.includes("unknown record type")));
});

test("conformance: validateRecord rejects non-object input", () => {
  assert.ok(validateRecord(null).some((m) => m.includes("must be a JSON object")));
  assert.ok(validateRecord("string").some((m) => m.includes("must be a JSON object")));
});

// ─── full decision → reconcile → outcome lifecycle ───────────────────────────

test("conformance: a complete decision/reconcile/outcome lifecycle all conform", () => {
  const now = new Date().toISOString();
  const d = orf.buildDecision(decisionSpec(), now);
  const r = orf.buildReconcile(reconcileSpec({ open_decision_id: d.id }), now);
  const o = orf.buildOutcome(
    { decision_id: d.id, observed_result: "version=2 confirmed", falsifier_observed: false },
    now
  );
  assert.deepEqual(validateDecisionRecord(d), [], "decision conforms");
  assert.deepEqual(validateReconcileRecord(r), [], "reconcile conforms");
  assert.deepEqual(validateOutcomeRecord(o), [], "outcome conforms");
});

// ─── delegation record (v0.3) ────────────────────────────────────────────────

test("conformance: reference buildDelegation produces a conforming record", () => {
  const d = orf.buildDelegation({
    id: "del-conf-1",
    delegating_agent: "orchestrator",
    delegate_agent: "monitor-agent",
    delegated_intent: "Harvest reply counts for the 11 target posts",
    delegate_ledger: "orf://monitor-agent/receipts",
    parent_decision_id: "cycle-conf-1",
    action_idempotency_key: "monitor-harvest-conf-1"
  }, new Date().toISOString());
  assert.deepEqual(validateDelegationRecord(d), []);
});

test("conformance: delegation record missing delegated_intent is invalid", () => {
  const d = orf.buildDelegation({ id: "del-2", delegating_agent: "a", delegate_agent: "b", delegated_intent: "x" }, "t");
  delete d.delegated_intent;
  const e = validateDelegationRecord(d);
  assert.ok(e.some((m) => m.includes("delegated_intent is required")));
});

test("conformance: delegation record missing delegate_agent is invalid", () => {
  const d = orf.buildDelegation({ id: "del-3", delegating_agent: "a", delegate_agent: "b", delegated_intent: "x" }, "t");
  delete d.delegate_agent;
  const e = validateDelegationRecord(d);
  assert.ok(e.some((m) => m.includes("delegate_agent is required")));
});

test("conformance: delegation record with uri falsifier is valid", () => {
  const d = orf.buildDelegation({
    id: "del-4", delegating_agent: "a", delegate_agent: "b", delegated_intent: "x",
    falsifier: { type: "uri", value: "orf://b/receipts — no receipt present", window_seconds: 60 }
  }, "t");
  assert.deepEqual(validateDelegationRecord(d), []);
});

test("conformance: delegation without optional fields is valid", () => {
  const d = orf.buildDelegation({ id: "del-5", delegating_agent: "a", delegate_agent: "b", delegated_intent: "x" }, "t");
  assert.deepEqual(validateDelegationRecord(d), []);
  assert.ok(!("delegate_ledger" in d));
  assert.ok(!("parent_decision_id" in d));
});

// ─── aggregate field on outcome (v0.3) ───────────────────────────────────────

test("conformance: outcome with valid aggregate conforms", () => {
  const o = orf.buildOutcome({
    decision_id: "cycle-1",
    observed_result: "2 of 3 tasks held",
    falsifier_observed: false,
    aggregate: {
      total: 3, held: 2, falsified: 0, undetermined: 1,
      sub_outcomes: [
        { decision_id: "del-a", status: "held" },
        { decision_id: "del-b", status: "held" },
        { decision_id: "del-c", status: "undetermined", notes: "network timeout" }
      ]
    }
  }, new Date().toISOString());
  assert.deepEqual(validateOutcomeRecord(o), []);
});

test("conformance: validateAggregate rejects count invariant violation", () => {
  const e = validateAggregate({ total: 3, held: 2, falsified: 1, undetermined: 1, sub_outcomes: [] });
  assert.ok(e.some((m) => m.includes("must equal total")));
});

test("conformance: validateAggregate rejects non-array sub_outcomes", () => {
  const e = validateAggregate({ total: 1, held: 1, falsified: 0, undetermined: 0, sub_outcomes: null });
  assert.ok(e.some((m) => m.includes("sub_outcomes must be an array")));
});

test("conformance: validateAggregate rejects missing sub_outcome decision_id", () => {
  const e = validateAggregate({ total: 1, held: 1, falsified: 0, undetermined: 0, sub_outcomes: [{ status: "held" }] });
  assert.ok(e.some((m) => m.includes("decision_id is required")));
});

test("conformance: validateAggregate rejects invalid sub_outcome status", () => {
  const e = validateAggregate({ total: 1, held: 0, falsified: 0, undetermined: 1, sub_outcomes: [{ decision_id: "x", status: "pending" }] });
  assert.ok(e.some((m) => m.includes("status must be one of")));
});

// ─── full delegation → outcome lifecycle (v0.3) ──────────────────────────────

test("conformance: orchestrator delegation lifecycle conforms end-to-end", () => {
  const now = new Date().toISOString();
  const del = orf.buildDelegation({
    id: "del-lifecycle-1",
    delegating_agent: "orchestrator",
    delegate_agent: "sub-agent",
    delegated_intent: "Process batch of 5 records",
    delegate_ledger: "orf://sub-agent/receipts",
    parent_decision_id: "cycle-lifecycle-1"
  }, now);
  const o = orf.buildOutcome({
    decision_id: "del-lifecycle-1",
    observed_result: "5 records processed; all held",
    falsifier_observed: false,
    aggregate: {
      total: 5, held: 5, falsified: 0, undetermined: 0,
      sub_outcomes: [
        { decision_id: "sub-1", status: "held" },
        { decision_id: "sub-2", status: "held" },
        { decision_id: "sub-3", status: "held" },
        { decision_id: "sub-4", status: "held" },
        { decision_id: "sub-5", status: "held" }
      ]
    }
  }, now);
  assert.deepEqual(validateDelegationRecord(del), [], "delegation conforms");
  assert.deepEqual(validateOutcomeRecord(o), [], "outcome with aggregate conforms");
});

// ─── v0.4: partial status in sub_outcomes and aggregate ──────────────────────

test("conformance: aggregate with partial sub_outcome conforms", () => {
  const o = orf.buildOutcome({
    decision_id: "orch-1",
    observed_result: "3 sub-tasks: 2 held, 1 partial (sub-orch had mixed results)",
    falsifier_observed: null,
    status: "partial",
    aggregate: {
      total: 3, held: 2, falsified: 0, undetermined: 0, partial: 1,
      sub_outcomes: [
        { decision_id: "sub-a", status: "held" },
        { decision_id: "sub-b", status: "held" },
        { decision_id: "sub-c", status: "partial", notes: "sub-orchestrator had 1 held, 1 falsified" }
      ]
    }
  }, new Date().toISOString());
  assert.deepEqual(validateOutcomeRecord(o), []);
});

test("conformance: outcome with status partial conforms (v0.4+)", () => {
  const o = orf.buildOutcome({
    decision_id: "batch-1",
    observed_result: "7 held, 2 falsified",
    falsifier_observed: null,
    status: "partial",
    aggregate: {
      total: 9, held: 7, falsified: 2, undetermined: 0,
      sub_outcomes: [
        { decision_id: "r-1", status: "held" }, { decision_id: "r-2", status: "held" },
        { decision_id: "r-3", status: "falsified", notes: "schema error" },
        { decision_id: "r-4", status: "held" }, { decision_id: "r-5", status: "held" },
        { decision_id: "r-6", status: "falsified", notes: "duplicate key" },
        { decision_id: "r-7", status: "held" }, { decision_id: "r-8", status: "held" },
        { decision_id: "r-9", status: "held" }
      ]
    }
  }, new Date().toISOString());
  assert.deepEqual(validateOutcomeRecord(o), []);
});

test("conformance: validateAggregate rejects count invariant when partial count is wrong", () => {
  const e = validateAggregate({
    total: 4, held: 2, falsified: 1, undetermined: 0, partial: 0,
    sub_outcomes: [
      { decision_id: "a", status: "held" }, { decision_id: "b", status: "held" },
      { decision_id: "c", status: "falsified" }
    ]
  });
  assert.ok(e.some((m) => m.includes("must equal total")),
    "invariant violation: 2+1+0+0=3 but total=4");
});

// ─── v0.5: resolution_policy on decision ─────────────────────────────────────

test("conformance: decision with resolution_policy conforms (v0.5+)", () => {
  const d = orf.buildDecision(
    decisionSpec({ resolution_policy: "majority_held_is_success" }),
    new Date().toISOString()
  );
  assert.deepEqual(validateDecisionRecord(d), []);
  assert.equal(d.resolution_policy, "majority_held_is_success");
});

test("conformance: decision with any_falsified_is_failure policy conforms (v0.5+)", () => {
  const d = orf.buildDecision(
    decisionSpec({ resolution_policy: "any_falsified_is_failure" }),
    new Date().toISOString()
  );
  assert.deepEqual(validateDecisionRecord(d), []);
});

test("conformance: decision with invalid resolution_policy is invalid (v0.5+)", () => {
  const d = orf.buildDecision(decisionSpec(), new Date().toISOString());
  d.resolution_policy = "unanimous_required";
  const e = validateDecisionRecord(d);
  assert.ok(e.some((m) => m.includes("resolution_policy must be one of")));
});

// ─── v0.6: resolution_policy on aggregate ────────────────────────────────────

test("conformance: outcome with aggregate.resolution_policy conforms (v0.6)", () => {
  const o = orf.buildOutcome({
    decision_id: "batch-2026-07-09",
    observed_result: "batch complete: 7 held, 2 falsified",
    falsifier_observed: null,
    status: "held",
    aggregate: {
      total: 9, held: 7, falsified: 2, undetermined: 0,
      resolution_policy: "majority_held_is_success",
      sub_outcomes: [
        { decision_id: "r-1", status: "held" }, { decision_id: "r-2", status: "held" },
        { decision_id: "r-3", status: "falsified", notes: "schema error" },
        { decision_id: "r-4", status: "held" }, { decision_id: "r-5", status: "held" },
        { decision_id: "r-6", status: "falsified", notes: "duplicate key" },
        { decision_id: "r-7", status: "held" }, { decision_id: "r-8", status: "held" },
        { decision_id: "r-9", status: "held" }
      ]
    }
  }, new Date().toISOString());
  assert.deepEqual(validateOutcomeRecord(o), []);
  assert.equal(o.aggregate.resolution_policy, "majority_held_is_success");
});

test("conformance: outcome with aggregate.resolution_policy=any_falsified_is_failure conforms (v0.6)", () => {
  const o = orf.buildOutcome({
    decision_id: "payment-batch-1",
    observed_result: "payment batch: 8 held, 1 failed",
    falsifier_observed: true,
    status: "falsified",
    aggregate: {
      total: 9, held: 8, falsified: 1, undetermined: 0,
      resolution_policy: "any_falsified_is_failure",
      sub_outcomes: [
        { decision_id: "pay-1", status: "held" }, { decision_id: "pay-2", status: "held" },
        { decision_id: "pay-3", status: "falsified", notes: "insufficient funds" },
        { decision_id: "pay-4", status: "held" }, { decision_id: "pay-5", status: "held" },
        { decision_id: "pay-6", status: "held" }, { decision_id: "pay-7", status: "held" },
        { decision_id: "pay-8", status: "held" }, { decision_id: "pay-9", status: "held" }
      ]
    }
  }, new Date().toISOString());
  assert.deepEqual(validateOutcomeRecord(o), []);
});

test("conformance: aggregate without resolution_policy is still valid (backward compat)", () => {
  const o = orf.buildOutcome({
    decision_id: "legacy-batch",
    observed_result: "3 held, 0 falsified",
    falsifier_observed: false,
    aggregate: {
      total: 3, held: 3, falsified: 0, undetermined: 0,
      sub_outcomes: [
        { decision_id: "a", status: "held" },
        { decision_id: "b", status: "held" },
        { decision_id: "c", status: "held" }
      ]
    }
  }, new Date().toISOString());
  assert.deepEqual(validateOutcomeRecord(o), []);
  assert.ok(!("resolution_policy" in o.aggregate), "absence of resolution_policy must be valid");
});

test("conformance: validateAggregate rejects invalid resolution_policy value (v0.6)", () => {
  const e = validateAggregate({
    total: 2, held: 1, falsified: 1, undetermined: 0,
    resolution_policy: "unanimous_required",
    sub_outcomes: [
      { decision_id: "a", status: "held" },
      { decision_id: "b", status: "falsified" }
    ]
  });
  assert.ok(e.some((m) => m.includes("aggregate.resolution_policy must be one of")));
});

test("conformance: aggregate.resolution_policy=custom is valid (v0.6)", () => {
  const e = validateAggregate({
    total: 3, held: 2, falsified: 1, undetermined: 0,
    resolution_policy: "custom",
    sub_outcomes: [
      { decision_id: "a", status: "held" },
      { decision_id: "b", status: "held" },
      { decision_id: "c", status: "falsified" }
    ]
  });
  assert.deepEqual(e, []);
});

test("conformance: delegation does not accept resolution_policy (v0.6 normative closure)", () => {
  const d = orf.buildDelegation({
    id: "del-v6-1", delegating_agent: "orch", delegate_agent: "sub", delegated_intent: "x"
  }, new Date().toISOString());
  assert.ok(!("resolution_policy" in d),
    "delegation records must not carry resolution_policy — it is the orchestrator's concern");
});

// ─── v0.9: aggregate.pending and in_progress checkpoint pattern ───────────────

test("conformance: aggregate with pending field satisfies extended invariant (v0.9)", () => {
  const e = validateAggregate({
    total: 3,
    held: 1,
    falsified: 0,
    undetermined: 0,
    pending: 2,
    sub_outcomes: [{ decision_id: "sub-a", status: "held" }]
  });
  assert.deepEqual(e, []);
});

test("conformance: aggregate.pending + resolved counts must equal total (v0.9)", () => {
  const e = validateAggregate({
    total: 3,
    held: 1,
    falsified: 0,
    undetermined: 0,
    pending: 1,
    sub_outcomes: [{ decision_id: "sub-a", status: "held" }]
  });
  assert.ok(e.some((m) => m.includes("must equal total")));
});

test("conformance: aggregate.pending 0 is valid (final record, no pending sub-tasks) (v0.9)", () => {
  const e = validateAggregate({
    total: 2,
    held: 2,
    falsified: 0,
    undetermined: 0,
    pending: 0,
    sub_outcomes: [
      { decision_id: "sub-a", status: "held" },
      { decision_id: "sub-b", status: "held" }
    ]
  });
  assert.deepEqual(e, []);
});

test("conformance: aggregate.pending must be non-negative integer (v0.9)", () => {
  const e1 = validateAggregate({
    total: 2, held: 1, falsified: 0, undetermined: 0, pending: -1,
    sub_outcomes: [{ decision_id: "x", status: "held" }]
  });
  assert.ok(e1.some((m) => m.includes("pending must be a non-negative integer")));

  const e2 = validateAggregate({
    total: 2, held: 1, falsified: 0, undetermined: 0, pending: 1.5,
    sub_outcomes: [{ decision_id: "x", status: "held" }]
  });
  assert.ok(e2.some((m) => m.includes("pending must be a non-negative integer")));
});

test("conformance: outcome with status in_progress and pending > 0 conforms (v0.9)", () => {
  const now = new Date().toISOString();
  const o = {
    orf_version: "0.9",
    record: "outcome",
    recorded_at: now,
    decision_id: "parallel-batch-1",
    observed_result: "sub-a held; sub-b and sub-c still running",
    falsifier_observed: null,
    status: "in_progress",
    aggregate: {
      total: 3,
      held: 1,
      falsified: 0,
      undetermined: 0,
      pending: 2,
      sub_outcomes: [{ decision_id: "sub-a", status: "held" }]
    }
  };
  assert.deepEqual(validateOutcomeRecord(o), []);
});

test("conformance: outcome in_progress with no aggregate is invalid (v0.9)", () => {
  const now = new Date().toISOString();
  const o = {
    orf_version: "0.9",
    record: "outcome",
    recorded_at: now,
    decision_id: "parallel-batch-2",
    observed_result: "running",
    falsifier_observed: null,
    status: "in_progress"
  };
  const e = validateOutcomeRecord(o);
  assert.ok(e.some((m) => m.includes("in_progress") && m.includes("aggregate")));
});

test("conformance: outcome in_progress with pending 0 is invalid (v0.9)", () => {
  const now = new Date().toISOString();
  const o = {
    orf_version: "0.9",
    record: "outcome",
    recorded_at: now,
    decision_id: "parallel-batch-3",
    observed_result: "all done",
    falsifier_observed: null,
    status: "in_progress",
    aggregate: {
      total: 2,
      held: 2,
      falsified: 0,
      undetermined: 0,
      pending: 0,
      sub_outcomes: [
        { decision_id: "sub-a", status: "held" },
        { decision_id: "sub-b", status: "held" }
      ]
    }
  };
  const e = validateOutcomeRecord(o);
  assert.ok(e.some((m) => m.includes("in_progress") && m.includes("pending")));
});

test("conformance: final outcome with pending > 0 is invalid (v0.9)", () => {
  const now = new Date().toISOString();
  const o = {
    orf_version: "0.9",
    record: "outcome",
    recorded_at: now,
    decision_id: "parallel-batch-4",
    observed_result: "sub-a held",
    falsifier_observed: false,
    status: "held",
    aggregate: {
      total: 3,
      held: 1,
      falsified: 0,
      undetermined: 0,
      pending: 2,
      sub_outcomes: [{ decision_id: "sub-a", status: "held" }]
    }
  };
  const e = validateOutcomeRecord(o);
  assert.ok(e.some((m) => m.includes("pending") && m.includes("in_progress")));
});

test("conformance: full checkpoint → final lifecycle conforms (v0.9)", () => {
  const now = new Date().toISOString();
  const checkpoint = {
    orf_version: "0.9",
    record: "outcome",
    recorded_at: now,
    decision_id: "parallel-batch-lifecycle",
    observed_result: "sub-a held; sub-b and sub-c still running",
    falsifier_observed: null,
    status: "in_progress",
    aggregate: {
      total: 3,
      held: 1,
      falsified: 0,
      undetermined: 0,
      pending: 2,
      resolution_policy: "any_falsified_is_failure",
      sub_outcomes: [{ decision_id: "sub-a", status: "held" }]
    }
  };
  const final = {
    orf_version: "0.9",
    record: "outcome",
    recorded_at: now,
    decision_id: "parallel-batch-lifecycle",
    observed_result: "sub-a: held; sub-b: held; sub-c: falsified (exit code 1)",
    falsifier_observed: true,
    status: "falsified",
    aggregate: {
      total: 3,
      held: 2,
      falsified: 1,
      undetermined: 0,
      pending: 0,
      resolution_policy: "any_falsified_is_failure",
      sub_outcomes: [
        { decision_id: "sub-a", status: "held" },
        { decision_id: "sub-b", status: "held" },
        { decision_id: "sub-c", status: "falsified", notes: "exit code 1" }
      ]
    }
  };
  assert.deepEqual(validateOutcomeRecord(checkpoint), [], "checkpoint conforms");
  assert.deepEqual(validateOutcomeRecord(final), [], "final record conforms");
});

test("conformance: sub_outcome status does not accept in_progress (v0.9)", () => {
  const e = validateAggregate({
    total: 2,
    held: 1,
    falsified: 0,
    undetermined: 0,
    pending: 1,
    sub_outcomes: [{ decision_id: "sub-a", status: "in_progress" }]
  });
  assert.ok(e.some((m) => m.includes("status must be one of")));
});

// ─── v0.10: custody records and the coordinator seat ─────────────────────────

function custodyRecord(o = {}) {
  return Object.assign(
    {
      orf_version: "0.10",
      record: "custody",
      recorded_at: "2026-09-05T17:12:00Z",
      id: "custody-0005",
      council: "orf-dev-council",
      seat_epoch: 5,
      from_agent: "chatgpt-5",
      to_agent: "claude-opus-5",
      reason: "budget_low"
    },
    o
  );
}

test("conformance: a v0.10 handoff record produced by the reference implementation validates", () => {
  const r = orf.buildCustody(
    {
      id: "custody-0005", council: "orf-dev-council", seat_epoch: 5,
      from_agent: "chatgpt-5", to_agent: "claude-opus-5", reason: "budget_low",
      budget: { window_seconds: 18000, remaining_fraction: 0.06, resets_at: "2026-09-05T21:00:00Z" },
      open_decisions: ["deploy-cfg-v2", "orf://gemini-ledger/import-batch-7"],
      roster: [
        { agent: "chatgpt-5", role: "hand", status: "exhausted", remaining_fraction: 0.06, resets_at: "2026-09-05T21:00:00Z" },
        { agent: "claude-opus-5", role: "coordinator", status: "available", remaining_fraction: 0.91, resets_at: "2026-09-05T22:30:00Z" }
      ],
      falsifier: { type: "predicate", value: "no custody record at seat_epoch 6 within 300s", window_seconds: 300 }
    },
    "2026-09-05T17:12:00Z"
  );
  assert.deepEqual(validateCustodyRecord(r), []);
  assert.deepEqual(validateRecord(r), [], "validateRecord dispatches custody records");
});

test("conformance: validateRecord recognizes custody as a record type", () => {
  const e = validateRecord({ record: "council" });
  assert.ok(e[0].includes("must be decision, reconcile, outcome, delegation, or custody"));
});

test("conformance: custody requires council and seat_epoch", () => {
  const noCouncil = custodyRecord();
  delete noCouncil.council;
  assert.ok(validateCustodyRecord(noCouncil).some((m) => m.includes("council is required")));

  const noEpoch = custodyRecord();
  delete noEpoch.seat_epoch;
  assert.ok(validateCustodyRecord(noEpoch).some((m) => m.includes("seat_epoch must be a non-negative integer")));
});

test("conformance: custody rejects an unknown reason", () => {
  const e = validateCustodyRecord(custodyRecord({ reason: "vibes" }));
  assert.ok(e.some((m) => m.includes("reason must be one of")));
});

test("conformance: invariant 2 — a custody record must move the seat", () => {
  const e = validateCustodyRecord(custodyRecord({ to_agent: "chatgpt-5" }));
  assert.ok(e.some((m) => m.includes("to_agent must differ from from_agent")));
});

test("conformance: invariant 3 — a null from_agent is a claim, not a transfer", () => {
  assert.deepEqual(
    validateCustodyRecord(custodyRecord({ seat_epoch: 0, from_agent: null, reason: "seat_claimed" })),
    [],
    "epoch 0 with reason seat_claimed conforms"
  );
  const e = validateCustodyRecord(custodyRecord({ from_agent: null, reason: "budget_low" }));
  assert.ok(e.some((m) => m.includes("from_agent may be null only at seat_epoch 0")));
});

test("conformance: invariant 4 — dormancy requires council_exhausted and resume_at", () => {
  const noResume = custodyRecord({ to_agent: null, reason: "council_exhausted" });
  assert.ok(validateCustodyRecord(noResume).some((m) => m.includes("resume_at is absent")));

  const wrongReason = custodyRecord({ to_agent: null, reason: "voluntary", resume_at: "2026-09-05T21:00:00Z" });
  assert.ok(validateCustodyRecord(wrongReason).some((m) => m.includes("council_exhausted")));

  const ok = custodyRecord({
    to_agent: null, reason: "council_exhausted", resume_at: "2026-09-05T21:00:00Z",
    roster: [
      { agent: "chatgpt-5", status: "exhausted", resets_at: "2026-09-05T21:00:00Z" },
      { agent: "grok-4.6", status: "exhausted", resets_at: "2026-09-06T00:05:00Z" }
    ]
  });
  assert.deepEqual(validateCustodyRecord(ok), [], "a well-formed dormancy record conforms");
});

test("conformance: resume_at must be the earliest reset among exhausted members", () => {
  const late = custodyRecord({
    to_agent: null, reason: "council_exhausted",
    resume_at: "2026-09-06T00:05:00Z",
    roster: [
      { agent: "chatgpt-5", status: "exhausted", resets_at: "2026-09-05T21:00:00Z" },
      { agent: "grok-4.6", status: "exhausted", resets_at: "2026-09-06T00:05:00Z" }
    ]
  });
  const e = validateCustodyRecord(late);
  assert.ok(e.some((m) => m.includes("earliest resets_at")), "resume_at must be when work CAN resume, not later");
});

test("conformance: custody rejects a malformed budget or roster", () => {
  assert.ok(
    validateCustodyRecord(custodyRecord({ budget: { remaining_fraction: 2 } })).some((m) =>
      m.includes("budget.remaining_fraction")
    )
  );
  assert.ok(
    validateCustodyRecord(custodyRecord({ budget: { window_seconds: 0 } })).some((m) =>
      m.includes("budget.window_seconds")
    )
  );
  assert.ok(
    validateCustodyRecord(custodyRecord({ roster: [{ role: "hand" }] })).some((m) => m.includes("roster[0].agent is required"))
  );
  assert.ok(
    validateCustodyRecord(custodyRecord({ roster: [{ agent: "x", status: "tired" }] })).some((m) =>
      m.includes("roster[0].status must be one of")
    )
  );
});

test("conformance: open_decisions must be an array of non-empty strings", () => {
  assert.ok(validateCustodyRecord(custodyRecord({ open_decisions: "d1" })).some((m) => m.includes("must be an array")));
  assert.ok(validateCustodyRecord(custodyRecord({ open_decisions: ["", "d2"] })).some((m) => m.includes("open_decisions[0]")));
  assert.deepEqual(validateCustodyRecord(custodyRecord({ open_decisions: ["d1", "orf://other/d2"] })), []);
});

test("conformance: invariant 1 — the seat chain has no gaps and no duplicate epochs", () => {
  const chain = [
    custodyRecord({ id: "c0", seat_epoch: 0, from_agent: null, to_agent: "chatgpt-5", reason: "seat_claimed" }),
    custodyRecord({ id: "c1", seat_epoch: 1, from_agent: "chatgpt-5", to_agent: "claude-opus-5" }),
    custodyRecord({ id: "c2", seat_epoch: 2, from_agent: "claude-opus-5", to_agent: "grok-4.6" })
  ];
  assert.deepEqual(validateCustodyChain(chain, "orf-dev-council"), []);

  const gapped = chain.concat([custodyRecord({ id: "c4", seat_epoch: 4, from_agent: "grok-4.6", to_agent: "chatgpt-5" })]);
  assert.ok(validateCustodyChain(gapped, "orf-dev-council").some((m) => m.includes("seat_epoch gap: expected 3")));

  const contested = chain.concat([custodyRecord({ id: "c2-dup", seat_epoch: 2, from_agent: "claude-opus-5", to_agent: "gemini-3.8-flash" })]);
  assert.ok(validateCustodyChain(contested, "orf-dev-council").some((m) => m.includes("duplicate custody record at seat_epoch 2")));
});

test("conformance: the seat chain is scoped per council", () => {
  const mixed = [
    custodyRecord({ id: "a0", council: "council-a", seat_epoch: 0, from_agent: null, to_agent: "x", reason: "seat_claimed" }),
    custodyRecord({ id: "b0", council: "council-b", seat_epoch: 0, from_agent: null, to_agent: "y", reason: "seat_claimed" })
  ];
  assert.deepEqual(validateCustodyChain(mixed, "council-a"), []);
  assert.deepEqual(validateCustodyChain(mixed, "council-b"), []);
});

test("conformance: v0.9 records remain valid alongside v0.10 custody records", () => {
  const v09 = {
    orf_version: "0.9",
    record: "outcome",
    recorded_at: "2026-07-10T10:02:00Z",
    decision_id: "parallel-batch",
    observed_result: "all three sub-agents held",
    falsifier_observed: false,
    status: "held",
    aggregate: { total: 3, held: 3, falsified: 0, undetermined: 0, partial: 0, pending: 0, sub_outcomes: [{ decision_id: "a", status: "held" }] }
  };
  assert.deepEqual(validateRecord(v09), [], "a v0.9 record is still conforming under v0.10");
  assert.deepEqual(validateRecord(custodyRecord()), []);
});
