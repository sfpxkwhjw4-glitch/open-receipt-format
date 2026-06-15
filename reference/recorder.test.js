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
  assert.equal(d.orf_version, "0.1");
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
  assert.equal(o.orf_version, "0.1");
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
