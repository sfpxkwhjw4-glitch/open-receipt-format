"use strict";
// Structural integrity test for orf-v0.10.schema.json.
//
// Does NOT require ajv or any external validator — just verifies the schema
// file is valid JSON and has the expected structure (correct record-type
// definitions, required field lists, and enum values that match the spec).
//
// Semantic validation (does this record conform?) is in conformance/validate.js.
// The conditional custody invariants — dormancy requires resume_at, a handoff
// must move the seat — are not expressible in draft-07 and live there, not here.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const SCHEMA_PATH = path.join(__dirname, "orf-v0.10.schema.json");

let schema;
test("schema file is valid JSON", () => {
  const raw = fs.readFileSync(SCHEMA_PATH, "utf8");
  schema = JSON.parse(raw);
});

test("top-level $schema is draft-07", () => {
  assert.ok(schema["$schema"].includes("draft-07"), "expected JSON Schema draft-07");
});

test("top-level oneOf references all five record types", () => {
  const refs = schema.oneOf.map((o) => o["$ref"]);
  for (const t of ["decision", "outcome", "reconcile", "delegation", "custody"]) {
    assert.ok(refs.includes(`#/definitions/${t}`), `missing ${t}`);
  }
  assert.equal(refs.length, 5, "unexpected extra entries in oneOf");
});

test("definitions contains all expected types", () => {
  const keys = Object.keys(schema.definitions);
  for (const k of [
    "decision", "outcome", "reconcile", "delegation", "custody",
    "falsifier", "falsifier_typed", "spend", "aggregate", "sub_outcome",
    "resolution_policy_enum", "custody_reason_enum", "budget", "roster_member"
  ]) {
    assert.ok(keys.includes(k), `missing definition: ${k}`);
  }
});

// ─── custody (new in v0.10) ─────────────────────────────────────────────────

const CUSTODY_REQUIRED = [
  "orf_version", "record", "recorded_at", "id",
  "council", "seat_epoch", "from_agent", "to_agent", "reason"
];

test("custody requires exactly the nine fields the spec lists", () => {
  const req = schema.definitions.custody.required;
  for (const f of CUSTODY_REQUIRED) assert.ok(req.includes(f), `custody must require ${f}`);
  assert.equal(req.length, CUSTODY_REQUIRED.length, `unexpected custody required fields: ${req.join(", ")}`);
});

test("custody.record is const custody", () => {
  assert.equal(schema.definitions.custody.properties.record.const, "custody");
});

test("custody is a v0.10+ record type only", () => {
  assert.deepEqual(schema.definitions.custody.properties.orf_version.enum, ["0.10"]);
});

test("seat_epoch is a non-negative integer", () => {
  const e = schema.definitions.custody.properties.seat_epoch;
  assert.equal(e.type, "integer");
  assert.equal(e.minimum, 0);
});

test("from_agent and to_agent both accept null", () => {
  for (const f of ["from_agent", "to_agent"]) {
    const types = schema.definitions.custody.properties[f].oneOf.map((o) => o.type);
    assert.ok(types.includes("null"), `${f} must accept null`);
    assert.ok(types.includes("string"), `${f} must accept a string`);
  }
});

test("custody_reason_enum has exactly the seven spec values", () => {
  const en = schema.definitions.custody_reason_enum.enum;
  for (const v of [
    "seat_claimed", "budget_low", "budget_exhausted", "voluntary",
    "unresponsive", "preempted_by_user", "council_exhausted"
  ]) {
    assert.ok(en.includes(v), `custody reason enum must include ${v}`);
  }
  assert.equal(en.length, 7, "reason enum must have exactly 7 values");
});

test("open_decisions is an array of non-empty strings", () => {
  const od = schema.definitions.custody.properties.open_decisions;
  assert.equal(od.type, "array");
  assert.equal(od.items.type, "string");
  assert.equal(od.items.minLength, 1);
});

test("resume_at is an ISO 8601 reference", () => {
  assert.equal(schema.definitions.custody.properties.resume_at["$ref"], "#/definitions/iso8601");
});

test("budget.remaining_fraction is bounded to 0..1", () => {
  const rf = schema.definitions.budget.properties.remaining_fraction;
  assert.equal(rf.minimum, 0);
  assert.equal(rf.maximum, 1);
});

test("roster_member requires agent and constrains role and status", () => {
  const rm = schema.definitions.roster_member;
  assert.deepEqual(rm.required, ["agent"]);
  assert.deepEqual(rm.properties.role.enum, ["coordinator", "hand", "observer"]);
  assert.deepEqual(rm.properties.status.enum, ["available", "exhausted", "unreachable", "onboarding"]);
});

test("custody.roster items reference roster_member", () => {
  assert.equal(schema.definitions.custody.properties.roster.items["$ref"], "#/definitions/roster_member");
});

// ─── unchanged from v0.9 ────────────────────────────────────────────────────

test("outcome status enum is unchanged from v0.9", () => {
  const en = schema.definitions.outcome.properties.status.enum;
  assert.deepEqual(en, ["held", "falsified", "undetermined", "partial", "in_progress"]);
});

test("resolution_policy_enum still has exactly three values", () => {
  assert.equal(schema.definitions.resolution_policy_enum.enum.length, 3);
});

test("aggregate still carries the v0.9 pending field", () => {
  const p = schema.definitions.aggregate.properties.pending;
  assert.equal(p.type, "integer");
  assert.equal(p.minimum, 0);
});

// ─── v0.10: existing record types accept the new version ────────────────────

test("v0.10: decision, outcome, reconcile, delegation all accept orf_version 0.10", () => {
  for (const t of ["decision", "outcome", "reconcile", "delegation"]) {
    const en = schema.definitions[t].properties.orf_version.enum;
    assert.ok(en.includes("0.10"), `${t} must accept orf_version 0.10`);
  }
});

// ─── backward compatibility: v0.1–v0.9 records still valid ──────────────────

test("backward compat: decision and outcome accept all v0.1–v0.9 versions", () => {
  for (const t of ["decision", "outcome"]) {
    const en = schema.definitions[t].properties.orf_version.enum;
    for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]) {
      assert.ok(en.includes(v), `backward compat: ${t} must still accept orf_version ${v}`);
    }
  }
});

test("backward compat: reconcile accepts v0.2+ and delegation accepts v0.3+", () => {
  const rec = schema.definitions.reconcile.properties.orf_version.enum;
  const del = schema.definitions.delegation.properties.orf_version.enum;
  for (const v of ["0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]) {
    assert.ok(rec.includes(v), `reconcile must still accept orf_version ${v}`);
  }
  for (const v of ["0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9"]) {
    assert.ok(del.includes(v), `delegation must still accept orf_version ${v}`);
  }
  assert.ok(!rec.includes("0.1"), "reconcile is not a v0.1 record type");
  assert.ok(!del.includes("0.2"), "delegation is not a v0.2 record type");
});
