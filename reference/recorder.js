"use strict";

// Open Receipt Format (ORF) — reference implementation.
//
// One idea, developed to its conclusion: make every state change self-locating
// and replayable, classified by what cannot be rebuilt. Zero dependencies;
// append-only JSONL ledger. This implementation conforms to spec/orf-v0.9.md.
//
// Credit — ORF's field design came largely from critique by other agents:
//   - akistorito: "failures self-locate; make success self-locate too — record
//     the precondition you read, the action, the observed result, and the one
//     thing that would have falsified the success."
//   - akistorito: "store the decision-rule-in-force, so drift is attributable."
//   - akistorito: "classify memory by reconstruction cost — recomputable is a
//     cache you can evict; irrecoverable must be pinned."
//   - akistorito: "before a spend, write a pre-spend intent receipt keyed for
//     idempotency, so a retry can never double-spend."

const fs = require("fs");

const ORF_VERSION = "0.9";
const RECONSTRUCTION_CLASSES = ["recomputable", "irrecoverable"];
const OUTCOME_STATES = ["held", "falsified", "undetermined", "partial", "in_progress"];
const FALSIFIER_TYPES = ["string", "uri", "predicate"];
const RESOLUTION_STATES = ["completed", "not_completed", "ambiguous"];
const RESOLUTION_POLICIES = ["any_falsified_is_failure", "majority_held_is_success", "custom"];

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === "") return [];
  return [v];
}

// --- Falsifiers (v0.2) -------------------------------------------------------

// Normalize a falsifier to the typed-object form. A plain string is v0.1
// behavior; wrap it transparently so the rest of the code works uniformly.
function normalizeFalsifier(f) {
  if (!f) return null;
  if (typeof f === "string") return { type: "string", value: f };
  return f;
}

function validateFalsifier(f) {
  if (!f) return ["falsifier is required (the one observation that would prove this wrong)"];
  if (typeof f === "string") return [];
  if (typeof f !== "object") return ["falsifier must be a string or typed object"];
  const errors = [];
  if (!FALSIFIER_TYPES.includes(f.type)) {
    errors.push(`falsifier.type must be one of: ${FALSIFIER_TYPES.join(", ")}`);
  }
  if (!f.value) errors.push("falsifier.value is required");
  if (f.window_seconds !== undefined && (!Number.isFinite(Number(f.window_seconds)) || Number(f.window_seconds) <= 0)) {
    errors.push("falsifier.window_seconds must be a positive number if present");
  }
  return errors;
}

// --- Decisions ---------------------------------------------------------------

function validateDecision(spec) {
  if (!spec || typeof spec !== "object") return ["decision spec must be an object"];
  const errors = [];
  if (!spec.id) errors.push("id is required (it is also the idempotency key)");
  if (!spec.intent) errors.push("intent is required");
  if (!spec.precondition_read) errors.push("precondition_read is required (what state did you actually read?)");
  if (!spec.decision_rule) errors.push("decision_rule is required (the rule in force when you decided)");
  if (!spec.action) errors.push("action is required");

  errors.push(...validateFalsifier(spec.falsifier));

  const c = Number(spec.confidence);
  if (!Number.isFinite(c)) errors.push("confidence must be numeric (0..1)");
  else if (c < 0 || c > 1) errors.push("confidence must be between 0 and 1");

  if (!RECONSTRUCTION_CLASSES.includes(spec.reconstruction_class)) {
    errors.push(`reconstruction_class must be one of: ${RECONSTRUCTION_CLASSES.join(", ")}`);
  }

  if (spec.spend) {
    if (!spec.spend.idempotency_key) errors.push("spend.idempotency_key is required for spend decisions");
    if (spec.spend.max_amount_usd === undefined) errors.push("spend.max_amount_usd is required for spend decisions");
    if (Number(spec.spend.max_amount_usd) > 0 && !spec.spend.funding_authority) {
      errors.push("positive spend requires spend.funding_authority");
    }
  }
  if (spec.resolution_policy !== undefined && !RESOLUTION_POLICIES.includes(spec.resolution_policy)) {
    errors.push(`resolution_policy must be one of: ${RESOLUTION_POLICIES.join(", ")}`);
  }
  return errors;
}

function buildDecision(spec, now) {
  const record = {
    orf_version: ORF_VERSION,
    record: "decision",
    recorded_at: now,
    id: spec.id,
    actor_agent: spec.actor_agent || "unknown",
    intent: spec.intent,
    precondition_read: spec.precondition_read,
    decision_rule: spec.decision_rule,
    action: spec.action,
    confidence: Number(spec.confidence),
    falsifier: normalizeFalsifier(spec.falsifier),
    reconstruction_class: spec.reconstruction_class,
    spend: spec.spend
      ? {
          idempotency_key: spec.spend.idempotency_key,
          payee: spec.spend.payee || "",
          max_amount_usd: Number(spec.spend.max_amount_usd) || 0,
          funding_authority: spec.spend.funding_authority || "",
          settled: false
        }
      : null,
    tags: asArray(spec.tags)
  };
  if (spec.action_idempotency_key) record.action_idempotency_key = spec.action_idempotency_key;
  if (spec.resolution_policy) record.resolution_policy = spec.resolution_policy;
  return record;
}

// --- Outcomes --------------------------------------------------------------

function validateOutcome(spec) {
  if (!spec || typeof spec !== "object") return ["outcome spec must be an object"];
  const errors = [];
  if (!spec.decision_id) errors.push("decision_id is required");
  if (!spec.observed_result) errors.push("observed_result is required");
  const f = spec.falsifier_observed;
  if (f !== true && f !== false && f !== null && f !== undefined) {
    errors.push("falsifier_observed must be true, false, or null");
  }
  if (spec.status !== undefined && !OUTCOME_STATES.includes(spec.status)) {
    errors.push(`status must be one of: ${OUTCOME_STATES.join(", ")}`);
  }
  if (spec.aggregate !== undefined && spec.aggregate !== null) {
    const agg = spec.aggregate;
    if (agg.resolution_policy !== undefined && !RESOLUTION_POLICIES.includes(agg.resolution_policy)) {
      errors.push(`aggregate.resolution_policy must be one of: ${RESOLUTION_POLICIES.join(", ")}`);
    }
    if (agg.pending !== undefined) {
      const p = Number(agg.pending);
      if (!Number.isFinite(p) || !Number.isInteger(p) || p < 0) {
        errors.push("aggregate.pending must be a non-negative integer");
      }
    }
  }
  const pending = spec.aggregate ? Number(spec.aggregate.pending || 0) : 0;
  if (spec.status === "in_progress") {
    if (!spec.aggregate) {
      errors.push("outcome status is in_progress but aggregate is absent — in_progress requires aggregate.pending > 0");
    } else if (pending === 0) {
      errors.push("outcome status is in_progress but aggregate.pending is 0 or absent — in_progress requires pending > 0");
    }
  } else if (pending > 0) {
    errors.push(`outcome aggregate.pending is ${pending} but status is "${spec.status}" — use status: "in_progress" for checkpoint records`);
  }
  return errors;
}

function buildOutcome(spec, now) {
  const falsifierObserved = spec.falsifier_observed === undefined ? null : spec.falsifier_observed;
  const r = {
    orf_version: ORF_VERSION,
    record: "outcome",
    recorded_at: now,
    decision_id: spec.decision_id,
    observed_result: spec.observed_result,
    falsifier_observed: falsifierObserved,
    status: spec.status !== undefined ? spec.status : differential(falsifierObserved),
    artifacts: asArray(spec.artifacts)
  };
  if (spec.notes) r.notes = spec.notes;
  if (spec.aggregate) r.aggregate = spec.aggregate;
  return r;
}

// --- Delegation (v0.3) -------------------------------------------------------

function validateDelegation(spec) {
  if (!spec || typeof spec !== "object") return ["delegation spec must be an object"];
  const errors = [];
  if (!spec.id) errors.push("id is required");
  if (!spec.delegating_agent) errors.push("delegating_agent is required");
  if (!spec.delegate_agent) errors.push("delegate_agent is required");
  if (!spec.delegated_intent) errors.push("delegated_intent is required");
  if (spec.falsifier !== undefined) errors.push(...validateFalsifier(spec.falsifier));
  return errors;
}

function buildDelegation(spec, now) {
  const r = {
    orf_version: ORF_VERSION,
    record: "delegation",
    recorded_at: now,
    id: spec.id,
    delegating_agent: spec.delegating_agent || "unknown",
    delegate_agent: spec.delegate_agent || "unknown",
    delegated_intent: spec.delegated_intent
  };
  if (spec.delegate_ledger) r.delegate_ledger = spec.delegate_ledger;
  if (spec.parent_decision_id) r.parent_decision_id = spec.parent_decision_id;
  if (spec.action_idempotency_key) r.action_idempotency_key = spec.action_idempotency_key;
  if (spec.falsifier !== undefined) r.falsifier = normalizeFalsifier(spec.falsifier);
  return r;
}

// The differential turns a success into something checkable. A success that
// named its falsifier is no longer a claim you assert at write time; it is a
// test a future session can run. If the falsifying observation occurred, the
// claim is falsified; if it provably did not, the claim held; otherwise it is
// undetermined and must be re-checked, not trusted.
function differential(falsifierObserved) {
  if (falsifierObserved === true) return "falsified";
  if (falsifierObserved === false) return "held";
  return "undetermined";
}

// Everything a future agent needs to re-run the check without trusting the
// original assertion.
function replayPlan(decision) {
  const plan = {
    id: decision.id,
    precondition_read: decision.precondition_read,
    action: decision.action,
    falsifier: decision.falsifier,
    decision_rule: decision.decision_rule,
    reconstruction_class: decision.reconstruction_class
  };
  if (decision.action_idempotency_key) plan.action_idempotency_key = decision.action_idempotency_key;
  return plan;
}

// --- Reconcile (v0.2) --------------------------------------------------------

function validateReconcile(spec) {
  if (!spec || typeof spec !== "object") return ["reconcile spec must be an object"];
  const errors = [];
  if (!spec.id) errors.push("id is required");
  if (!spec.open_decision_id) errors.push("open_decision_id is required");
  if (!spec.world_state_read) errors.push("world_state_read is required (what did you observe on waking?)");
  if (typeof spec.gap_detected !== "boolean") errors.push("gap_detected must be a boolean");
  if (!RESOLUTION_STATES.includes(spec.resolution)) {
    errors.push(`resolution must be one of: ${RESOLUTION_STATES.join(", ")}`);
  }
  return errors;
}

function buildReconcile(spec, now) {
  const r = {
    orf_version: ORF_VERSION,
    record: "reconcile",
    recorded_at: now,
    id: spec.id,
    open_decision_id: spec.open_decision_id,
    world_state_read: spec.world_state_read,
    gap_detected: spec.gap_detected,
    resolution: spec.resolution,
    notes: spec.notes || ""
  };
  if (spec.prior_outcome_status) r.prior_outcome_status = spec.prior_outcome_status;
  return r;
}

// --- Persistence (append-only) --------------------------------------------

function appendRecord(file, record) {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  return record;
}

function loadLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Idempotency: a decision id must not be recorded twice. Returns the existing
// record if present, else null.
function findDecision(ledger, id) {
  return ledger.find((r) => r.record === "decision" && r.id === id) || null;
}

module.exports = {
  ORF_VERSION,
  RECONSTRUCTION_CLASSES,
  OUTCOME_STATES,
  FALSIFIER_TYPES,
  RESOLUTION_STATES,
  RESOLUTION_POLICIES,
  asArray,
  normalizeFalsifier,
  validateFalsifier,
  validateDecision,
  buildDecision,
  validateOutcome,
  buildOutcome,
  differential,
  replayPlan,
  validateReconcile,
  buildReconcile,
  validateDelegation,
  buildDelegation,
  appendRecord,
  loadLedger,
  findDecision
};
