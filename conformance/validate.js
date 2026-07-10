"use strict";
// ORF conformance validators (updated through v0.8).
//
// Pass any JSON record produced by your implementation.
// An empty errors array means the record conforms to the ORF spec.
//
// These validators are implementation-agnostic: they check the JSON output,
// not the builder functions that produced it. Any language can use them.

const FALSIFIER_TYPES = ["string", "uri", "predicate"];
const RECONSTRUCTION_CLASSES = ["recomputable", "irrecoverable"];
const RESOLUTION_STATES = ["completed", "not_completed", "ambiguous"];
const OUTCOME_STATUSES = ["held", "falsified", "undetermined", "partial", "in_progress"];
const SUB_OUTCOME_STATUSES = ["held", "falsified", "undetermined", "partial"];
const RESOLUTION_POLICIES = ["any_falsified_is_failure", "majority_held_is_success", "custom"];

function validateFalsifier(f) {
  if (f === null || f === undefined) return ["falsifier is required"];
  if (typeof f === "string") return [];
  if (typeof f !== "object") return ["falsifier must be a string or typed object"];
  const e = [];
  if (!FALSIFIER_TYPES.includes(f.type)) {
    e.push(`falsifier.type must be one of: ${FALSIFIER_TYPES.join(", ")}`);
  }
  if (!f.value) e.push("falsifier.value is required");
  if (f.window_seconds !== undefined) {
    const w = Number(f.window_seconds);
    if (!Number.isFinite(w) || w <= 0) e.push("falsifier.window_seconds must be a positive number");
  }
  return e;
}

function validateDecisionRecord(r) {
  if (!r || r.record !== "decision") return ['record field must equal "decision"'];
  const e = [];
  if (!r.orf_version) e.push("orf_version is required");
  if (!r.recorded_at) e.push("recorded_at is required (ISO 8601 timestamp)");
  if (!r.id) e.push("id is required");
  if (!r.actor_agent) e.push("actor_agent is required");
  if (!r.intent) e.push("intent is required");
  if (!r.precondition_read) e.push("precondition_read is required");
  if (!r.decision_rule) e.push("decision_rule is required");
  if (!r.action) e.push("action is required");
  const c = Number(r.confidence);
  if (!Number.isFinite(c) || c < 0 || c > 1) {
    e.push("confidence must be a number between 0 and 1");
  }
  e.push(...validateFalsifier(r.falsifier));
  if (!RECONSTRUCTION_CLASSES.includes(r.reconstruction_class)) {
    e.push(`reconstruction_class must be one of: ${RECONSTRUCTION_CLASSES.join(", ")}`);
  }
  if (r.resolution_policy !== undefined && !RESOLUTION_POLICIES.includes(r.resolution_policy)) {
    e.push(`resolution_policy must be one of: ${RESOLUTION_POLICIES.join(", ")}`);
  }
  return e;
}

function validateReconcileRecord(r) {
  if (!r || r.record !== "reconcile") return ['record field must equal "reconcile"'];
  const e = [];
  if (!r.orf_version) e.push("orf_version is required");
  if (!r.recorded_at) e.push("recorded_at is required (ISO 8601 timestamp)");
  if (!r.id) e.push("id is required");
  if (!r.open_decision_id) e.push("open_decision_id is required");
  if (!r.world_state_read) e.push("world_state_read is required");
  if (typeof r.gap_detected !== "boolean") e.push("gap_detected must be a boolean");
  if (!RESOLUTION_STATES.includes(r.resolution)) {
    e.push(`resolution must be one of: ${RESOLUTION_STATES.join(", ")}`);
  }
  return e;
}

function validateAggregate(agg) {
  if (!agg || typeof agg !== "object") return ["aggregate must be an object"];
  const e = [];
  const total = Number(agg.total);
  const held = Number(agg.held);
  const falsified = Number(agg.falsified);
  const undetermined = Number(agg.undetermined);
  const partial = Number(agg.partial || 0);
  if (!Number.isFinite(total) || !Number.isInteger(total) || total < 1) e.push("aggregate.total must be a positive integer");
  if (!Number.isFinite(held) || !Number.isInteger(held) || held < 0) e.push("aggregate.held must be a non-negative integer");
  if (!Number.isFinite(falsified) || !Number.isInteger(falsified) || falsified < 0) e.push("aggregate.falsified must be a non-negative integer");
  if (!Number.isFinite(undetermined) || !Number.isInteger(undetermined) || undetermined < 0) e.push("aggregate.undetermined must be a non-negative integer");
  if (agg.partial !== undefined) {
    if (!Number.isFinite(partial) || !Number.isInteger(partial) || partial < 0) {
      e.push("aggregate.partial must be a non-negative integer");
    }
  }
  const pending = Number(agg.pending || 0);
  if (agg.pending !== undefined) {
    if (!Number.isFinite(pending) || !Number.isInteger(pending) || pending < 0) {
      e.push("aggregate.pending must be a non-negative integer");
    }
  }
  if (e.length === 0 && held + falsified + undetermined + partial + pending !== total) {
    e.push("aggregate: held + falsified + undetermined + partial + pending must equal total");
  }
  if (agg.resolution_policy !== undefined && !RESOLUTION_POLICIES.includes(agg.resolution_policy)) {
    e.push(`aggregate.resolution_policy must be one of: ${RESOLUTION_POLICIES.join(", ")}`);
  }
  if (!Array.isArray(agg.sub_outcomes)) {
    e.push("aggregate.sub_outcomes must be an array");
  } else {
    agg.sub_outcomes.forEach((so, i) => {
      if (!so.decision_id) e.push(`aggregate.sub_outcomes[${i}].decision_id is required`);
      if (!SUB_OUTCOME_STATUSES.includes(so.status)) {
        e.push(`aggregate.sub_outcomes[${i}].status must be one of: ${SUB_OUTCOME_STATUSES.join(", ")}`);
      }
    });
  }
  return e;
}

function validateOutcomeRecord(r) {
  if (!r || r.record !== "outcome") return ['record field must equal "outcome"'];
  const e = [];
  if (!r.orf_version) e.push("orf_version is required");
  if (!r.recorded_at) e.push("recorded_at is required (ISO 8601 timestamp)");
  if (!r.decision_id) e.push("decision_id is required");
  if (!r.observed_result) e.push("observed_result is required");
  if (r.falsifier_observed !== true && r.falsifier_observed !== false && r.falsifier_observed !== null) {
    e.push("falsifier_observed must be true, false, or null");
  }
  if (!OUTCOME_STATUSES.includes(r.status)) {
    e.push(`status must be one of: ${OUTCOME_STATUSES.join(", ")}`);
  }
  if (r.aggregate !== undefined) e.push(...validateAggregate(r.aggregate));
  const pending = r.aggregate ? Number(r.aggregate.pending || 0) : 0;
  if (r.status === "in_progress") {
    if (!r.aggregate) {
      e.push("outcome status is in_progress but aggregate is absent — in_progress requires aggregate.pending > 0");
    } else if (pending === 0) {
      e.push("outcome status is in_progress but aggregate.pending is 0 or absent — in_progress requires pending > 0");
    }
  } else if (pending > 0) {
    e.push(`outcome aggregate.pending is ${pending} but status is "${r.status}" — use status: "in_progress" for checkpoint records`);
  }
  return e;
}

function validateDelegationRecord(r) {
  if (!r || r.record !== "delegation") return ['record field must equal "delegation"'];
  const e = [];
  if (!r.orf_version) e.push("orf_version is required");
  if (!r.recorded_at) e.push("recorded_at is required (ISO 8601 timestamp)");
  if (!r.id) e.push("id is required");
  if (!r.delegating_agent) e.push("delegating_agent is required");
  if (!r.delegate_agent) e.push("delegate_agent is required");
  if (!r.delegated_intent) e.push("delegated_intent is required");
  if (r.falsifier !== undefined) e.push(...validateFalsifier(r.falsifier));
  return e;
}

// Validate any record: dispatches by r.record type.
function validateRecord(r) {
  if (!r || typeof r !== "object") return ["record must be a JSON object"];
  switch (r.record) {
    case "decision": return validateDecisionRecord(r);
    case "reconcile": return validateReconcileRecord(r);
    case "outcome": return validateOutcomeRecord(r);
    case "delegation": return validateDelegationRecord(r);
    default: return [`unknown record type: "${r.record}" — must be decision, reconcile, outcome, or delegation`];
  }
}

module.exports = {
  validateFalsifier,
  validateAggregate,
  validateDecisionRecord,
  validateReconcileRecord,
  validateOutcomeRecord,
  validateDelegationRecord,
  validateRecord,
  FALSIFIER_TYPES,
  RECONSTRUCTION_CLASSES,
  RESOLUTION_STATES,
  OUTCOME_STATUSES,
  SUB_OUTCOME_STATUSES,
  RESOLUTION_POLICIES
};
