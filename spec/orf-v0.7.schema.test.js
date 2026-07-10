"use strict";
// Structural integrity test for orf-v0.7.schema.json.
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

const SCHEMA_PATH = path.join(__dirname, "orf-v0.7.schema.json");

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

test("resolution_policy_enum definition has exactly three values", () => {
  const en = schema.definitions.resolution_policy_enum.enum;
  assert.ok(en.includes("any_falsified_is_failure"), "must include any_falsified_is_failure");
  assert.ok(en.includes("majority_held_is_success"), "must include majority_held_is_success");
  assert.ok(en.includes("custom"), "must include custom");
  assert.equal(en.length, 3, "enum must have exactly 3 values");
});

test("resolution_policy_enum is type string", () => {
  assert.equal(schema.definitions.resolution_policy_enum.type, "string");
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

test("decision.orf_version allows 0.1 through 0.7 (backward compat)", () => {
  const en = schema.definitions.decision.properties.orf_version.enum;
  for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7"]) {
    assert.ok(en.includes(v), `decision must allow orf_version ${v}`);
  }
});

test("decision.orf_version v0.7 is present (new in v0.7)", () => {
  const en = schema.definitions.decision.properties.orf_version.enum;
  assert.ok(en.includes("0.7"), "decision.orf_version must include 0.7");
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

test("decision has optional artifacts array of strings", () => {
  const p = schema.definitions.decision.properties;
  assert.ok(p.artifacts, "artifacts property must exist on decision");
  assert.equal(p.artifacts.type, "array");
  assert.equal(p.artifacts.items.type, "string");
  assert.ok(!schema.definitions.decision.required.includes("artifacts"),
    "artifacts must be optional");
});

// ─── v0.5: resolution_policy on decision (declared policy) ──────────────────

test("decision.resolution_policy is optional (from v0.5)", () => {
  const p = schema.definitions.decision.properties;
  assert.ok(p.resolution_policy, "resolution_policy property must exist on decision");
  assert.ok(!schema.definitions.decision.required.includes("resolution_policy"),
    "resolution_policy must be optional");
});

test("decision.resolution_policy references the shared resolution_policy_enum", () => {
  const rp = schema.definitions.decision.properties.resolution_policy;
  assert.ok(
    rp["$ref"] === "#/definitions/resolution_policy_enum",
    "decision.resolution_policy must reference resolution_policy_enum"
  );
});

test("decision.resolution_policy description names it the declared policy (v0.7)", () => {
  const rp = schema.definitions.decision.properties.resolution_policy;
  const desc = rp.description || "";
  assert.ok(
    desc.toLowerCase().includes("declared"),
    "decision.resolution_policy description must name it the declared policy"
  );
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

test("outcome.orf_version allows 0.1 through 0.7", () => {
  const en = schema.definitions.outcome.properties.orf_version.enum;
  for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7"]) {
    assert.ok(en.includes(v), `outcome must allow orf_version ${v}`);
  }
});

test("outcome.orf_version v0.7 is present (new in v0.7)", () => {
  const en = schema.definitions.outcome.properties.orf_version.enum;
  assert.ok(en.includes("0.7"), "outcome.orf_version must include 0.7");
});

test("outcome.status enum includes held, falsified, undetermined, and partial", () => {
  const en = schema.definitions.outcome.properties.status.enum;
  assert.ok(en.includes("held"), "outcome.status must include held");
  assert.ok(en.includes("falsified"), "outcome.status must include falsified");
  assert.ok(en.includes("undetermined"), "outcome.status must include undetermined");
  assert.ok(en.includes("partial"), "outcome.status must include partial");
  assert.deepEqual([...en].sort(), ["falsified", "held", "partial", "undetermined"]);
});

test("outcome.falsifier_observed allows boolean and null", () => {
  const fo = schema.definitions.outcome.properties.falsifier_observed;
  const types = fo.oneOf.map((o) => o.type);
  assert.ok(types.includes("boolean"), "falsifier_observed must allow boolean");
  assert.ok(types.includes("null"), "falsifier_observed must allow null");
});

test("outcome has optional aggregate field referencing aggregate definition", () => {
  const p = schema.definitions.outcome.properties;
  assert.ok(p.aggregate, "aggregate property must exist on outcome");
  assert.ok(p.aggregate["$ref"] || p.aggregate.allOf, "aggregate must reference aggregate definition");
  assert.ok(!schema.definitions.outcome.required.includes("aggregate"),
    "aggregate must be optional");
});

test("outcome has optional notes field (SHOULD document policy divergence)", () => {
  const p = schema.definitions.outcome.properties;
  assert.ok(p.notes, "notes property must exist on outcome");
  assert.equal(p.notes.type, "string");
  assert.ok(!schema.definitions.outcome.required.includes("notes"),
    "notes must be optional");
});

// ─── aggregate ──────────────────────────────────────────────────────────────

const AGGREGATE_REQUIRED = ["total", "held", "falsified", "undetermined", "sub_outcomes"];

test("aggregate required fields match spec (partial and resolution_policy are optional)", () => {
  const { required } = schema.definitions.aggregate;
  for (const f of AGGREGATE_REQUIRED) {
    assert.ok(required.includes(f), `aggregate: missing required field "${f}"`);
  }
  assert.equal(required.length, AGGREGATE_REQUIRED.length, "aggregate: unexpected extra required fields");
  assert.ok(!required.includes("partial"), "aggregate.partial must be optional");
  assert.ok(!required.includes("resolution_policy"), "aggregate.resolution_policy must be optional");
});

test("aggregate.partial is optional non-negative integer", () => {
  const p = schema.definitions.aggregate.properties.partial;
  assert.ok(p, "aggregate.partial property must exist");
  assert.equal(p.type, "integer");
  assert.equal(p.minimum, 0);
  assert.ok(!schema.definitions.aggregate.required.includes("partial"),
    "aggregate.partial must be optional");
});

// ─── v0.6: resolution_policy on aggregate (applied policy) ──────────────────

test("aggregate.resolution_policy is optional (from v0.6)", () => {
  const p = schema.definitions.aggregate.properties;
  assert.ok(p.resolution_policy, "resolution_policy property must exist on aggregate");
  assert.ok(!schema.definitions.aggregate.required.includes("resolution_policy"),
    "aggregate.resolution_policy must be optional");
});

test("aggregate.resolution_policy references the shared resolution_policy_enum", () => {
  const rp = schema.definitions.aggregate.properties.resolution_policy;
  assert.ok(
    rp["$ref"] === "#/definitions/resolution_policy_enum",
    "aggregate.resolution_policy must reference resolution_policy_enum"
  );
});

test("aggregate.resolution_policy description names it the applied policy (v0.7)", () => {
  const rp = schema.definitions.aggregate.properties.resolution_policy;
  const desc = rp.description || "";
  assert.ok(
    desc.toLowerCase().includes("applied"),
    "aggregate.resolution_policy description must name it the applied policy"
  );
});

test("aggregate.total is integer with minimum 1", () => {
  const t = schema.definitions.aggregate.properties.total;
  assert.equal(t.type, "integer");
  assert.equal(t.minimum, 1);
});

test("aggregate count fields (held, falsified, undetermined) are non-negative integers", () => {
  for (const f of ["held", "falsified", "undetermined"]) {
    const p = schema.definitions.aggregate.properties[f];
    assert.equal(p.type, "integer", `${f} must be integer`);
    assert.equal(p.minimum, 0, `${f} minimum must be 0`);
  }
});

test("aggregate.sub_outcomes is array of sub_outcome refs with minItems 1", () => {
  const so = schema.definitions.aggregate.properties.sub_outcomes;
  assert.equal(so.type, "array");
  assert.ok(so.items["$ref"] && so.items["$ref"].includes("sub_outcome"),
    "sub_outcomes items must reference sub_outcome definition");
  assert.equal(so.minItems, 1);
});

// ─── sub_outcome ────────────────────────────────────────────────────────────

const SUB_OUTCOME_REQUIRED = ["decision_id", "status"];

test("sub_outcome required fields match spec", () => {
  const { required } = schema.definitions.sub_outcome;
  for (const f of SUB_OUTCOME_REQUIRED) {
    assert.ok(required.includes(f), `sub_outcome: missing required field "${f}"`);
  }
  assert.equal(required.length, SUB_OUTCOME_REQUIRED.length, "sub_outcome: unexpected extra required fields");
});

test("sub_outcome.status enum includes partial", () => {
  const en = schema.definitions.sub_outcome.properties.status.enum;
  assert.ok(en.includes("held"), "sub_outcome.status must include held");
  assert.ok(en.includes("falsified"), "sub_outcome.status must include falsified");
  assert.ok(en.includes("undetermined"), "sub_outcome.status must include undetermined");
  assert.ok(en.includes("partial"), "sub_outcome.status must include partial");
  assert.deepEqual([...en].sort(), ["falsified", "held", "partial", "undetermined"]);
});

test("sub_outcome.notes is optional string", () => {
  const p = schema.definitions.sub_outcome.properties;
  assert.ok(p.notes, "notes property must exist on sub_outcome");
  assert.equal(p.notes.type, "string");
  assert.ok(!schema.definitions.sub_outcome.required.includes("notes"), "notes must be optional");
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

test("reconcile.orf_version allows 0.2 through 0.7 (reconcile is v0.2+)", () => {
  const en = schema.definitions.reconcile.properties.orf_version.enum;
  for (const v of ["0.2", "0.3", "0.4", "0.5", "0.6", "0.7"]) {
    assert.ok(en.includes(v), `reconcile must allow orf_version ${v}`);
  }
  assert.ok(!en.includes("0.1"), "reconcile must not allow orf_version 0.1");
});

test("reconcile.orf_version v0.7 is present (new in v0.7)", () => {
  const en = schema.definitions.reconcile.properties.orf_version.enum;
  assert.ok(en.includes("0.7"), "reconcile.orf_version must include 0.7");
});

test("reconcile.resolution enum matches spec (unchanged)", () => {
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

test("reconcile.prior_outcome_status is optional (from v0.5)", () => {
  const p = schema.definitions.reconcile.properties;
  assert.ok(p.prior_outcome_status, "prior_outcome_status property must exist on reconcile");
  assert.ok(!schema.definitions.reconcile.required.includes("prior_outcome_status"),
    "prior_outcome_status must be optional");
});

test("reconcile.prior_outcome_status enum matches outcome status values", () => {
  const en = schema.definitions.reconcile.properties.prior_outcome_status.enum;
  assert.ok(en.includes("held"), "prior_outcome_status must include held");
  assert.ok(en.includes("falsified"), "prior_outcome_status must include falsified");
  assert.ok(en.includes("undetermined"), "prior_outcome_status must include undetermined");
  assert.ok(en.includes("partial"), "prior_outcome_status must include partial");
  assert.deepEqual([...en].sort(), ["falsified", "held", "partial", "undetermined"]);
});

// ─── delegation ─────────────────────────────────────────────────────────────

const DELEGATION_REQUIRED = [
  "orf_version", "record", "recorded_at", "id",
  "delegating_agent", "delegate_agent", "delegated_intent"
];

test("delegation required fields match spec", () => {
  const { required } = schema.definitions.delegation;
  for (const f of DELEGATION_REQUIRED) {
    assert.ok(required.includes(f), `delegation: missing required field "${f}"`);
  }
  assert.equal(required.length, DELEGATION_REQUIRED.length, "delegation: unexpected extra required fields");
});

test("delegation.record const is 'delegation'", () => {
  assert.equal(schema.definitions.delegation.properties.record.const, "delegation");
});

test("delegation.orf_version allows 0.3 through 0.7 (delegation is v0.3+)", () => {
  const { orf_version } = schema.definitions.delegation.properties;
  assert.ok(!orf_version.const, "delegation.orf_version must not use const");
  assert.ok(orf_version.enum, "delegation.orf_version must use enum");
  for (const v of ["0.3", "0.4", "0.5", "0.6", "0.7"]) {
    assert.ok(orf_version.enum.includes(v), `delegation must allow orf_version ${v}`);
  }
  assert.ok(!orf_version.enum.includes("0.1"), "delegation must not allow orf_version 0.1");
  assert.ok(!orf_version.enum.includes("0.2"), "delegation must not allow orf_version 0.2");
});

test("delegation.orf_version v0.7 is present (new in v0.7)", () => {
  const { orf_version } = schema.definitions.delegation.properties;
  assert.ok(orf_version.enum.includes("0.7"), "delegation.orf_version must include 0.7");
});

test("delegation does NOT have resolution_policy field (v0.6 normative closure holds)", () => {
  const p = schema.definitions.delegation.properties;
  assert.ok(!p.resolution_policy,
    "delegation must not have resolution_policy — policy is the orchestrator's concern, not the delegation record's");
});

test("delegation.delegate_ledger is optional string", () => {
  const p = schema.definitions.delegation.properties;
  assert.ok(p.delegate_ledger, "delegate_ledger property must exist");
  assert.equal(p.delegate_ledger.type, "string");
  assert.ok(!schema.definitions.delegation.required.includes("delegate_ledger"),
    "delegate_ledger must be optional");
});

test("delegation.parent_decision_id is optional string", () => {
  const p = schema.definitions.delegation.properties;
  assert.ok(p.parent_decision_id, "parent_decision_id property must exist");
  assert.equal(p.parent_decision_id.type, "string");
  assert.ok(!schema.definitions.delegation.required.includes("parent_decision_id"),
    "parent_decision_id must be optional");
});

// ─── v0.7: declared vs. applied policy structural checks ────────────────────

test("decision and aggregate both have resolution_policy but neither is required", () => {
  const decProps = schema.definitions.decision.properties;
  const aggProps = schema.definitions.aggregate.properties;
  assert.ok(decProps.resolution_policy, "decision must have resolution_policy");
  assert.ok(aggProps.resolution_policy, "aggregate must have resolution_policy");
  assert.ok(!schema.definitions.decision.required.includes("resolution_policy"),
    "decision.resolution_policy must not be required");
  assert.ok(!schema.definitions.aggregate.required.includes("resolution_policy"),
    "aggregate.resolution_policy must not be required");
});

test("outcome.notes field exists and is optional (SHOULD document policy divergence per v0.7)", () => {
  const p = schema.definitions.outcome.properties;
  assert.ok(p.notes, "outcome.notes must exist");
  assert.equal(p.notes.type, "string");
  assert.ok(!schema.definitions.outcome.required.includes("notes"),
    "outcome.notes must be optional (SHOULD not MUST)");
});
