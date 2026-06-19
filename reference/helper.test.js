"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helper");

// --- decision() ---------------------------------------------------------------

test("decision() builds a conforming orf_version=0.2 record", () => {
  const d = h.decision("d1", {
    actor: "test-agent", intent: "do a thing",
    precondition: "state=ok", rule: "act when ok",
    action: "wrote file", falsifier: "file absent on read-back",
    confidence: 0.9, reconClass: "irrecoverable"
  });
  assert.equal(d.orf_version, "0.2");
  assert.equal(d.record, "decision");
  assert.equal(d.id, "d1");
  assert.equal(d.actor_agent, "test-agent");
  assert.equal(d.intent, "do a thing");
  assert.equal(d.precondition_read, "state=ok");
  assert.equal(d.decision_rule, "act when ok");
  assert.equal(d.action, "wrote file");
  assert.equal(d.confidence, 0.9);
  assert.equal(d.reconstruction_class, "irrecoverable");
  assert.equal(d.spend, null);
  assert.deepEqual(d.tags, []);
});

test("decision() has a recorded_at timestamp", () => {
  const d = h.decision("d2", { confidence: 0.5, reconClass: "recomputable" });
  assert.ok(typeof d.recorded_at === "string" && d.recorded_at.length > 0);
});

test("decision() normalizes a plain-string falsifier to typed object", () => {
  const d = h.decision("d3", { falsifier: "error_rate spikes", confidence: 0.5, reconClass: "recomputable" });
  assert.deepEqual(d.falsifier, { type: "string", value: "error_rate spikes" });
});

test("decision() passes a typed uri falsifier through unchanged", () => {
  const f = { type: "uri", value: "GET /health — status != active", window_seconds: 300 };
  const d = h.decision("d4", { falsifier: f, confidence: 0.8, reconClass: "irrecoverable" });
  assert.deepEqual(d.falsifier, f);
});

test("decision() includes action_idempotency_key when provided", () => {
  const d = h.decision("d5", { idempotencyKey: "deploy-v2", confidence: 0.5, reconClass: "recomputable" });
  assert.equal(d.action_idempotency_key, "deploy-v2");
});

test("decision() omits action_idempotency_key when not provided", () => {
  const d = h.decision("d6", { confidence: 0.5, reconClass: "recomputable" });
  assert.ok(!("action_idempotency_key" in d));
});

test("decision() defaults actor_agent to 'unknown' when omitted", () => {
  const d = h.decision("d7", {});
  assert.equal(d.actor_agent, "unknown");
});

test("decision() accepts tags array", () => {
  const d = h.decision("d8", { tags: ["outbound", "deploy"], confidence: 0.5, reconClass: "recomputable" });
  assert.deepEqual(d.tags, ["outbound", "deploy"]);
});

// --- reconcile() --------------------------------------------------------------

test("reconcile() builds a conforming reconcile record", () => {
  const r = h.reconcile("r1", {
    openDecisionId: "d1",
    worldStateRead: "file exists, hash=abc123",
    gapDetected: false,
    resolution: "completed"
  });
  assert.equal(r.orf_version, "0.2");
  assert.equal(r.record, "reconcile");
  assert.equal(r.id, "r1");
  assert.equal(r.open_decision_id, "d1");
  assert.equal(r.world_state_read, "file exists, hash=abc123");
  assert.equal(r.gap_detected, false);
  assert.equal(r.resolution, "completed");
  assert.equal(r.notes, "");
});

test("reconcile() has a recorded_at timestamp", () => {
  const r = h.reconcile("r2", { openDecisionId: "d1", worldStateRead: "x", gapDetected: false, resolution: "completed" });
  assert.ok(typeof r.recorded_at === "string" && r.recorded_at.length > 0);
});

test("reconcile() preserves notes when provided", () => {
  const r = h.reconcile("r3", {
    openDecisionId: "d1", worldStateRead: "x", gapDetected: true,
    resolution: "ambiguous", notes: "could not determine state from logs"
  });
  assert.equal(r.notes, "could not determine state from logs");
});

test("reconcile() supports all three resolution states", () => {
  for (const res of ["completed", "not_completed", "ambiguous"]) {
    const r = h.reconcile(`r-${res}`, { openDecisionId: "d1", worldStateRead: "x", gapDetected: false, resolution: res });
    assert.equal(r.resolution, res);
  }
});

// --- outcome() ----------------------------------------------------------------

test("outcome() builds a conforming outcome record", () => {
  const o = h.outcome("d1", { observedResult: "file written", falsifierObserved: false });
  assert.equal(o.orf_version, "0.2");
  assert.equal(o.record, "outcome");
  assert.equal(o.decision_id, "d1");
  assert.equal(o.observed_result, "file written");
  assert.equal(o.falsifier_observed, false);
  assert.equal(o.status, "held");
  assert.deepEqual(o.artifacts, []);
});

test("outcome() derives status=falsified when falsifierObserved=true", () => {
  const o = h.outcome("d1", { observedResult: "x", falsifierObserved: true });
  assert.equal(o.status, "falsified");
});

test("outcome() derives status=undetermined when falsifierObserved=null", () => {
  const o = h.outcome("d1", { observedResult: "x", falsifierObserved: null });
  assert.equal(o.status, "undetermined");
});

test("outcome() derives status=undetermined when falsifierObserved is omitted", () => {
  const o = h.outcome("d1", { observedResult: "x" });
  assert.equal(o.falsifier_observed, null);
  assert.equal(o.status, "undetermined");
});

test("outcome() has a recorded_at timestamp", () => {
  const o = h.outcome("d1", { observedResult: "x" });
  assert.ok(typeof o.recorded_at === "string" && o.recorded_at.length > 0);
});
