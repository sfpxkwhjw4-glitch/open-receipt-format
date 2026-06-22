"use strict";
// Structural integrity test for orf-v0.2.schema.json.
//
// Does NOT require ajv or any external validator — just verifies the schema
// file is valid JSON and has the expected structure (correct record-type
// definitions, required field lists, and enum values that match the spec).
//
// Semantic validation (does this record conform?) is in conformance/validate.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const SCHEMA_PATH = path.join(__dirname, "orf-v0.2.schema.json");

let schema;
test("schema file is valid JSON", () => {
  const raw = fs.readFileSync(SCHEMA_PATH, "utf8");
  schema = JSON.parse(raw);
});

test("top-level $schema is draft-07", () => {
  assert.ok(schema["$schema"].includes("draft-07"), "expected JSON Schema draft-07");
});

test("top-level oneOf references all three record types", () => {
  const refs = schema.oneOf.map((o) => o["$ref"]);
  assert.ok(refs.includes("#/definitions/decision"), "missing decision");
  assert.ok(refs.includes("#/definitions/outcome"), "missing outcome");
  assert.ok(refs.includes("#/definitions/reconcile"), "missing reconcile");
  assert.equal(refs.length, 3, "unexpected extra entries in oneOf");
});

test("definitions contains decision, outcome, reconcile, falsifier, falsifier_typed, spend", () => {
  const keys = Object.keys(schema.definitions);
  for (const k of ["decision", "outcome", "reconcile", "falsifier", "falsifier_typed", "spend"]) {
    assert.ok(keys.includes(k), `missing definition: ${k}`);
  }
});

// ─── decision ───────────────────────────────────────────────────────────────

const DECISION_REQUIRED = [
  "orf_version", "record", "recorded_at", "id", "actor_agent",
  "intent", "precondition_read", "decision_rule", "action",
  "confidence", "falsifier", "reconstruction_class"
];

test("decision required fields match spec", () => {
  const { required } = schema.definitions.decision;
  for (const f of DECISION_REQUIRED) {
    assert.ok(required.includes(f), `decision: missing required field "${f}"`);
  }
  assert.equal(required.length, DECISION_REQUIRED.length, "decision: unexpected extra required fields");
});

test("decision.record const is 'decision'", () => {
  assert.equal(schema.definitions.decision.properties.record.const, "decision");
});

test("decision.orf_version allows 0.1 and 0.2 (backward compat)", () => {
  const en = schema.definitions.decision.properties.orf_version.enum;
  assert.ok(en.includes("0.1"), "decision must allow orf_version 0.1");
  assert.ok(en.includes("0.2"), "decision must allow orf_version 0.2");
});

test("decision.reconstruction_class enum matches spec", () => {
  const en = schema.definitions.decision.properties.reconstruction_class.enum;
  assert.deepEqual([...en].sort(), ["irrecoverable", "recomputable"]);
});

test("decision.confidence is number 0..1", () => {
  const c = schema.definitions.decision.properties.confidence;
  assert.equal(c.type, "number");
  assert.equal(c.minimum, 0);
  assert.equal(c.maximum, 1);
});

test("decision.action_idempotency_key is optional string property", () => {
  const p = schema.definitions.decision.properties;
  assert.ok(p.action_idempotency_key, "action_idempotency_key property must exist");
  assert.equal(p.action_idempotency_key.type, "string");
  assert.ok(!schema.definitions.decision.required.includes("action_idempotency_key"),
    "action_idempotency_key must be optional");
});

// ─── outcome ────────────────────────────────────────────────────────────────

const OUTCOME_REQUIRED = [
  "orf_version", "record", "recorded_at",
  "decision_id", "observed_result", "falsifier_observed", "status"
];

test("outcome required fields match spec", () => {
  const { required } = schema.definitions.outcome;
  for (const f of OUTCOME_REQUIRED) {
    assert.ok(required.includes(f), `outcome: missing required field "${f}"`);
  }
  assert.equal(required.length, OUTCOME_REQUIRED.length, "outcome: unexpected extra required fields");
});

test("outcome.record const is 'outcome'", () => {
  assert.equal(schema.definitions.outcome.properties.record.const, "outcome");
});

test("outcome.status enum matches spec", () => {
  const en = schema.definitions.outcome.properties.status.enum;
  assert.deepEqual([...en].sort(), ["falsified", "held", "undetermined"]);
});

test("outcome.falsifier_observed allows boolean and null", () => {
  const fo = schema.definitions.outcome.properties.falsifier_observed;
  const types = fo.oneOf.map((o) => o.type);
  assert.ok(types.includes("boolean"), "falsifier_observed must allow boolean");
  assert.ok(types.includes("null"), "falsifier_observed must allow null");
});

// ─── reconcile ──────────────────────────────────────────────────────────────

const RECONCILE_REQUIRED = [
  "orf_version", "record", "recorded_at", "id",
  "open_decision_id", "world_state_read", "gap_detected", "resolution"
];

test("reconcile required fields match spec", () => {
  const { required } = schema.definitions.reconcile;
  for (const f of RECONCILE_REQUIRED) {
    assert.ok(required.includes(f), `reconcile: missing required field "${f}"`);
  }
  assert.equal(required.length, RECONCILE_REQUIRED.length, "reconcile: unexpected extra required fields");
});

test("reconcile.record const is 'reconcile'", () => {
  assert.equal(schema.definitions.reconcile.properties.record.const, "reconcile");
});

test("reconcile.orf_version const is '0.2' (reconcile is v0.2-only)", () => {
  assert.equal(schema.definitions.reconcile.properties.orf_version.const, "0.2");
});

test("reconcile.resolution enum matches spec", () => {
  const en = schema.definitions.reconcile.properties.resolution.enum;
  assert.deepEqual([...en].sort(), ["ambiguous", "completed", "not_completed"]);
});

test("reconcile.gap_detected is boolean", () => {
  assert.equal(schema.definitions.reconcile.properties.gap_detected.type, "boolean");
});

test("reconcile.notes is optional string", () => {
  const p = schema.definitions.reconcile.properties;
  assert.ok(p.notes, "notes property must exist");
  assert.equal(p.notes.type, "string");
  assert.ok(!schema.definitions.reconcile.required.includes("notes"), "notes must be optional");
});

// ─── falsifier ──────────────────────────────────────────────────────────────

test("falsifier is a oneOf: string or falsifier_typed ref", () => {
  const { oneOf } = schema.definitions.falsifier;
  const types = oneOf.map((o) => o.type || o["$ref"]);
  assert.ok(types.includes("string"), "falsifier must allow string");
  assert.ok(types.some((t) => t && t.includes("falsifier_typed")), "falsifier must ref falsifier_typed");
});

test("falsifier_typed.type enum matches spec", () => {
  const en = schema.definitions.falsifier_typed.properties.type.enum;
  assert.deepEqual([...en].sort(), ["predicate", "string", "uri"]);
});

test("falsifier_typed.window_seconds is optional positive number", () => {
  const w = schema.definitions.falsifier_typed.properties.window_seconds;
  assert.equal(w.type, "number");
  // draft-07: exclusiveMinimum: 0 means value must be > 0 (positive)
  assert.equal(w.exclusiveMinimum, 0, "window_seconds exclusiveMinimum must be 0 (enforces > 0)");
  assert.ok(!schema.definitions.falsifier_typed.required.includes("window_seconds"),
    "window_seconds must be optional");
});
