"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helper");

// --- decision() ---------------------------------------------------------------

test("decision() builds a conforming orf_version=0.3 record", () => {
  const d = h.decision("d1", {
    actor: "test-agent", intent: "do a thing",
    precondition: "state=ok", rule: "act when ok",
    action: "wrote file", falsifier: "file absent on read-back",
    confidence: 0.9, reconClass: "irrecoverable"
  });
  assert.equal(d.orf_version, "0.4");
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
  assert.equal(r.orf_version, "0.4");
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
  assert.equal(o.orf_version, "0.4");
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

test("outcome() includes aggregate when provided", () => {
  const agg = { total: 3, held: 2, falsified: 0, undetermined: 1, sub_outcomes: [
    { decision_id: "sub-a", status: "held" },
    { decision_id: "sub-b", status: "held" },
    { decision_id: "sub-c", status: "undetermined", notes: "network timeout" }
  ]};
  const o = h.outcome("d1", { observedResult: "2 of 3 held", falsifierObserved: false, aggregate: agg });
  assert.deepEqual(o.aggregate, agg);
});

test("outcome() omits aggregate when not provided", () => {
  const o = h.outcome("d1", { observedResult: "x", falsifierObserved: false });
  assert.ok(!("aggregate" in o));
});

// --- delegation() (v0.3) ------------------------------------------------------

test("delegation() builds a conforming delegation record", () => {
  const d = h.delegation("del-1", {
    delegatingAgent: "orchestrator",
    delegateAgent: "monitor-agent",
    delegatedIntent: "Harvest reply counts for 11 target posts",
    delegateLedger: "orf://monitor-agent/receipts",
    parentDecisionId: "cycle-2026-06-29"
  });
  assert.equal(d.orf_version, "0.4");
  assert.equal(d.record, "delegation");
  assert.equal(d.id, "del-1");
  assert.equal(d.delegating_agent, "orchestrator");
  assert.equal(d.delegate_agent, "monitor-agent");
  assert.equal(d.delegated_intent, "Harvest reply counts for 11 target posts");
  assert.equal(d.delegate_ledger, "orf://monitor-agent/receipts");
  assert.equal(d.parent_decision_id, "cycle-2026-06-29");
});

test("delegation() has a recorded_at timestamp", () => {
  const d = h.delegation("del-2", { delegatingAgent: "a", delegateAgent: "b", delegatedIntent: "do x" });
  assert.ok(typeof d.recorded_at === "string" && d.recorded_at.length > 0);
});

test("delegation() defaults delegating_agent and delegate_agent to 'unknown' when omitted", () => {
  const d = h.delegation("del-3", { delegatedIntent: "do x" });
  assert.equal(d.delegating_agent, "unknown");
  assert.equal(d.delegate_agent, "unknown");
});

test("delegation() omits optional fields when not provided", () => {
  const d = h.delegation("del-4", { delegatingAgent: "a", delegateAgent: "b", delegatedIntent: "x" });
  assert.ok(!("delegate_ledger" in d));
  assert.ok(!("parent_decision_id" in d));
  assert.ok(!("action_idempotency_key" in d));
  assert.ok(!("falsifier" in d));
});

test("delegation() includes action_idempotency_key when provided", () => {
  const d = h.delegation("del-5", { delegatingAgent: "a", delegateAgent: "b", delegatedIntent: "x", idempotencyKey: "invoke-monitor-2026-06-29" });
  assert.equal(d.action_idempotency_key, "invoke-monitor-2026-06-29");
});

test("delegation() normalizes a plain-string falsifier to typed object", () => {
  const d = h.delegation("del-6", { delegatingAgent: "a", delegateAgent: "b", delegatedIntent: "x", falsifier: "agent exits non-zero" });
  assert.deepEqual(d.falsifier, { type: "string", value: "agent exits non-zero" });
});

test("delegation() passes a typed uri falsifier through unchanged", () => {
  const f = { type: "uri", value: "GET orf://monitor-agent/receipts — no receipt for this cycle", window_seconds: 300 };
  const d = h.delegation("del-7", { delegatingAgent: "a", delegateAgent: "b", delegatedIntent: "x", falsifier: f });
  assert.deepEqual(d.falsifier, f);
});
