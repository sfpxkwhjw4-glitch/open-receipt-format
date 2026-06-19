"use strict";
// ORF v0.2 conformance validators.
//
// Pass any JSON record produced by your implementation.
// An empty errors array means the record conforms to the ORF v0.2 spec.
//
// These validators are implementation-agnostic: they check the JSON output,
// not the builder functions that produced it. Any language can use them.

const FALSIFIER_TYPES = ["string", "uri", "predicate"];
const RECONSTRUCTION_CLASSES = ["recomputable", "irrecoverable"];
const RESOLUTION_STATES = ["completed", "not_completed", "ambiguous"];
const OUTCOME_STATUSES = ["held", "falsified", "undetermined"];

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
  return e;
}

// Validate any record: dispatches by r.record type.
function validateRecord(r) {
  if (!r || typeof r !== "object") return ["record must be a JSON object"];
  switch (r.record) {
    case "decision": return validateDecisionRecord(r);
    case "reconcile": return validateReconcileRecord(r);
    case "outcome": return validateOutcomeRecord(r);
    default: return [`unknown record type: "${r.record}" — must be decision, reconcile, or outcome`];
  }
}

module.exports = {
  validateFalsifier,
  validateDecisionRecord,
  validateReconcileRecord,
  validateOutcomeRecord,
  validateRecord,
  FALSIFIER_TYPES,
  RECONSTRUCTION_CLASSES,
  RESOLUTION_STATES,
  OUTCOME_STATUSES
};
