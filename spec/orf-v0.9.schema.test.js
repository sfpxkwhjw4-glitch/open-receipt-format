"use strict";
// Structural integrity test for orf-v0.9.schema.json.
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

const SCHEMA_PATH = path.join(__dirname, "orf-v0.9.schema.json");

let schema;
test("schema file is valid JSON", () => {
  const raw = fs.readFileSync(SCHEMA_PATH, "utf8");
  schema = JSON.parse(raw);
});

test("top-level $schema is draft-07", () => {
  assert.ok(schema["$schema"].includes("draft-07"), "expected JSON Schema draft-07");
});

test("top-level oneOf references all four record types", () => {
  const refs = schema.oneOf.map((o) => o["$ref"]);
  assert.ok(refs.includes("#/definitions/decision"), "missing decision");
  assert.ok(refs.includes("#/definitions/outcome"), "missing outcome");
  assert.ok(refs.includes("#/definitions/reconcile"), "missing reconcile");
  assert.ok(refs.includes("#/definitions/delegation"), "missing delegation");
  assert.equal(refs.length, 4, "unexpected extra entries in oneOf");
});

test("definitions contains all expected types", () => {
  const keys = Object.keys(schema.definitions);
  for (const k of [
    "decision", "outcome", "reconcile", "delegation",
    "falsifier", "falsifier_typed", "spend", "aggregate", "sub_outcome",
    "resolution_policy_enum"
  ]) {
    assert.ok(keys.includes(k), `missing definition: ${k}`);
  }
});

// ─── resolution_policy_enum shared definition ───────────────────────────────

test("resolution_policy_enum definition has exactly three values (unchanged from v0.8)", () => {
  const en = schema.definitions.resolution_policy_enum.enum;
  assert.ok(en.includes("any_falsified_is_failure"), "must include any_falsified_is_failure");
  assert.ok(en.includes("majority_held_is_success"), "must include majority_held_is_success");
  assert.ok(en.includes("custom"), "must include custom");
  assert.equal(en.length, 3, "enum must have exactly 3 values");
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

test("decision.orf_version allows 0.1 through 0.9 (backward compat)", () => {
  const en = schema.definitions.decision.properties.orf_version.enum;
  for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]) {
    assert.ok(en.includes(v), `decision must allow orf_version ${v}`);
  }
});

test("decision.orf_version v0.9 is present (new in v0.9)", () => {
  const en = schema.definitions.decision.properties.orf_version.enum;
  assert.ok(en.includes("0.9"), "decision.orf_version must include 0.9");
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

test("outcome.orf_version allows 0.1 through 0.9", () => {
  const en = schema.definitions.outcome.properties.orf_version.enum;
  for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]) {
    assert.ok(en.includes(v), `outcome must allow orf_version ${v}`);
  }
});

test("outcome.orf_version v0.9 is present (new in v0.9)", () => {
  const en = schema.definitions.outcome.properties.orf_version.enum;
  assert.ok(en.includes("0.9"), "outcome.orf_version must include 0.9");
});

// ─── v0.9: outcome.status includes in_progress ──────────────────────────────

test("v0.9: outcome.status enum includes in_progress", () => {
  const en = schema.definitions.outcome.properties.status.enum;
  assert.ok(en.includes("in_progress"), "outcome.status must include in_progress (v0.9 checkpoint)");
});

test("v0.9: outcome.status enum is exactly {held, falsified, undetermined, partial, in_progress}", () => {
  const en = schema.definitions.outcome.properties.status.enum;
  assert.deepEqual([...en].sort(), ["falsified", "held", "in_progress", "partial", "undetermined"]);
});

test("v0.9: outcome.status description references in_progress checkpoint semantics", () => {
  const desc = schema.definitions.outcome.properties.status.description || "";
  assert.ok(
    desc.includes("in_progress") || desc.includes("checkpoint"),
    "outcome.status description must reference in_progress or checkpoint semantics"
  );
});

test("v0.9: outcome.aggregate description references in_progress requirement for checkpoints", () => {
  const desc = schema.definitions.outcome.properties.aggregate.description || "";
  assert.ok(
    desc.includes("in_progress") || desc.includes("checkpoint"),
    "outcome.aggregate description must mention in_progress or checkpoint usage"
  );
});

// ─── aggregate ──────────────────────────────────────────────────────────────

const AGGREGATE_REQUIRED = ["total", "held", "falsified", "undetermined", "sub_outcomes"];

test("aggregate required fields match spec (partial, pending, and resolution_policy are optional)", () => {
  const { required } = schema.definitions.aggregate;
  for (const f of AGGREGATE_REQUIRED) {
    assert.ok(required.includes(f), `aggregate: missing required field "${f}"`);
  }
  assert.equal(required.length, AGGREGATE_REQUIRED.length, "aggregate: unexpected extra required fields");
  assert.ok(!required.includes("partial"), "aggregate.partial must be optional");
  assert.ok(!required.includes("pending"), "aggregate.pending must be optional");
  assert.ok(!required.includes("resolution_policy"), "aggregate.resolution_policy must be optional");
});

// ─── v0.9: aggregate.pending ─────────────────────────────────────────────────

test("v0.9: aggregate.pending is optional non-negative integer", () => {
  const p = schema.definitions.aggregate.properties.pending;
  assert.ok(p, "aggregate.pending property must exist");
  assert.equal(p.type, "integer");
  assert.equal(p.minimum, 0);
  assert.ok(!schema.definitions.aggregate.required.includes("pending"),
    "aggregate.pending must be optional");
});

test("v0.9: aggregate.pending description references streaming/checkpoint pattern", () => {
  const desc = schema.definitions.aggregate.properties.pending.description || "";
  assert.ok(
    desc.includes("pending") && (desc.includes("checkpoint") || desc.includes("in_progress") || desc.includes("streaming")),
    "aggregate.pending description must reference checkpoint or streaming pattern"
  );
});

test("v0.9: aggregate.pending description references extended total invariant", () => {
  const desc = schema.definitions.aggregate.properties.pending.description || "";
  assert.ok(
    desc.includes("total") && desc.includes("pending"),
    "aggregate.pending description must reference the extended total invariant"
  );
});

test("v0.9: aggregate.sub_outcomes description updated for checkpoint partial-listing", () => {
  const desc = schema.definitions.aggregate.properties.sub_outcomes.description || "";
  assert.ok(
    desc.includes("pending") || desc.includes("checkpoint"),
    "aggregate.sub_outcomes description must acknowledge checkpoint/pending scenario"
  );
});

test("aggregate.partial is optional non-negative integer (unchanged from v0.8)", () => {
  const p = schema.definitions.aggregate.properties.partial;
  assert.ok(p, "aggregate.partial property must exist");
  assert.equal(p.type, "integer");
  assert.equal(p.minimum, 0);
  assert.ok(!schema.definitions.aggregate.required.includes("partial"),
    "aggregate.partial must be optional");
});

test("aggregate.total is integer with minimum 1 (unchanged)", () => {
  const t = schema.definitions.aggregate.properties.total;
  assert.equal(t.type, "integer");
  assert.equal(t.minimum, 1);
});

// ─── sub_outcome ─────────────────────────────────────────────────────────────

test("sub_outcome.status enum does NOT include in_progress (pending sub-tasks have no entry)", () => {
  const en = schema.definitions.sub_outcome.properties.status.enum;
  assert.ok(!en.includes("in_progress"),
    "sub_outcome.status must not include in_progress — pending sub-tasks have no sub_outcome entry");
  assert.deepEqual([...en].sort(), ["falsified", "held", "partial", "undetermined"]);
});

test("sub_outcome.status description clarifies pending sub-tasks have no entry (v0.9)", () => {
  const desc = schema.definitions.sub_outcome.properties.status.description || "";
  assert.ok(
    desc.toLowerCase().includes("pending") || desc.toLowerCase().includes("resolution_policy") || desc.toLowerCase().includes("spec"),
    "sub_outcome.status description must address pending sub-tasks or resolution_policy treatment"
  );
});

// ─── reconcile ──────────────────────────────────────────────────────────────

test("reconcile.orf_version allows 0.2 through 0.9 (reconcile is v0.2+)", () => {
  const en = schema.definitions.reconcile.properties.orf_version.enum;
  for (const v of ["0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]) {
    assert.ok(en.includes(v), `reconcile must allow orf_version ${v}`);
  }
  assert.ok(!en.includes("0.1"), "reconcile must not allow orf_version 0.1");
});

test("reconcile.orf_version v0.9 is present (new in v0.9)", () => {
  const en = schema.definitions.reconcile.properties.orf_version.enum;
  assert.ok(en.includes("0.9"), "reconcile.orf_version must include 0.9");
});

// ─── v0.9: reconcile.prior_outcome_status includes in_progress ──────────────

test("v0.9: reconcile.prior_outcome_status includes in_progress", () => {
  const en = schema.definitions.reconcile.properties.prior_outcome_status.enum;
  assert.ok(en.includes("in_progress"),
    "reconcile.prior_outcome_status must include in_progress (v0.9: for reconciling after a checkpoint outcome)");
});

test("v0.9: reconcile.prior_outcome_status enum is exactly {held, falsified, undetermined, partial, in_progress}", () => {
  const en = schema.definitions.reconcile.properties.prior_outcome_status.enum;
  assert.deepEqual([...en].sort(), ["falsified", "held", "in_progress", "partial", "undetermined"]);
});

// ─── delegation ──────────────────────────────────────────────────────────────

test("delegation.orf_version allows 0.3 through 0.9 (delegation is v0.3+)", () => {
  const { orf_version } = schema.definitions.delegation.properties;
  for (const v of ["0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]) {
    assert.ok(orf_version.enum.includes(v), `delegation must allow orf_version ${v}`);
  }
  assert.ok(!orf_version.enum.includes("0.1"), "delegation must not allow orf_version 0.1");
  assert.ok(!orf_version.enum.includes("0.2"), "delegation must not allow orf_version 0.2");
});

test("delegation.orf_version v0.9 is present (new in v0.9)", () => {
  const { orf_version } = schema.definitions.delegation.properties;
  assert.ok(orf_version.enum.includes("0.9"), "delegation.orf_version must include 0.9");
});

test("delegation does NOT have resolution_policy field (v0.6 normative closure holds)", () => {
  const p = schema.definitions.delegation.properties;
  assert.ok(!p.resolution_policy,
    "delegation must not have resolution_policy — policy is the orchestrator's concern, not the delegation record's");
});

// ─── v0.9: all record types accept orf_version 0.9 ──────────────────────────

test("v0.9: all record types accept orf_version 0.9", () => {
  const decEn = schema.definitions.decision.properties.orf_version.enum;
  const outEn = schema.definitions.outcome.properties.orf_version.enum;
  const recEn = schema.definitions.reconcile.properties.orf_version.enum;
  const delEn = schema.definitions.delegation.properties.orf_version.enum;
  assert.ok(decEn.includes("0.9"), "decision must accept orf_version 0.9");
  assert.ok(outEn.includes("0.9"), "outcome must accept orf_version 0.9");
  assert.ok(recEn.includes("0.9"), "reconcile must accept orf_version 0.9");
  assert.ok(delEn.includes("0.9"), "delegation must accept orf_version 0.9");
});

// ─── backward compatibility: v0.1–v0.8 records still valid ──────────────────

test("backward compat: decision accepts all v0.1–v0.8 versions", () => {
  const en = schema.definitions.decision.properties.orf_version.enum;
  for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8"]) {
    assert.ok(en.includes(v), `backward compat: decision must still accept orf_version ${v}`);
  }
});

test("backward compat: outcome accepts all v0.1–v0.8 versions", () => {
  const en = schema.definitions.outcome.properties.orf_version.enum;
  for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8"]) {
    assert.ok(en.includes(v), `backward compat: outcome must still accept orf_version ${v}`);
  }
});
