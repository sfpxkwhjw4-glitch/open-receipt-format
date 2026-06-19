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
  validateDecisionRecord,
  validateReconcileRecord,
  validateOutcomeRecord,
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
  assert.deepEqual(validateRecord(d), []);
  assert.deepEqual(validateRecord(r), []);
  assert.deepEqual(validateRecord(o), []);
});

test("conformance: validateRecord rejects unknown record type", () => {
  const e = validateRecord({ record: "audit", orf_version: "0.2" });
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
