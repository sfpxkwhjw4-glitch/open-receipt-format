"use strict";
// ORF conformance validators (updated through v0.10).
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
const CUSTODY_REASONS = [
  "seat_claimed", "budget_low", "budget_exhausted", "voluntary",
  "unresponsive", "preempted_by_user", "council_exhausted"
];
const MEMBER_ROLES = ["coordinator", "hand", "observer"];
const MEMBER_STATES = ["available", "exhausted", "unreachable", "onboarding"];

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


// --- custody (v0.10) --------------------------------------------------------
//
// The seat invariants live here rather than in the JSON Schema because three of
// the four are conditional: they relate from_agent, to_agent, reason, and
// resume_at to each other. A schema can say "these fields exist"; only a
// validator can say "a seat held by nobody must say when it ends."

function validateCustodyRecord(r) {
  if (!r || r.record !== "custody") return ['record field must equal "custody"'];
  const e = [];
  if (!r.orf_version) e.push("orf_version is required");
  if (!r.recorded_at) e.push("recorded_at is required (ISO 8601 timestamp)");
  if (!r.id) e.push("id is required");
  if (!r.council) e.push("council is required (it scopes seat_epoch)");
  if (!Number.isInteger(r.seat_epoch) || r.seat_epoch < 0) {
    e.push("seat_epoch must be a non-negative integer");
  }
  if (r.from_agent === undefined) e.push("from_agent is required (null when claiming an empty seat)");
  if (r.to_agent === undefined) e.push("to_agent is required (null to record council dormancy)");
  if (!CUSTODY_REASONS.includes(r.reason)) {
    e.push(`reason must be one of: ${CUSTODY_REASONS.join(", ")}`);
  }

  // Invariant 3: epoch 0 is a claim, not a transfer.
  if (r.from_agent === null && r.seat_epoch !== 0 && r.reason !== "seat_claimed") {
    e.push('from_agent may be null only at seat_epoch 0, or with reason "seat_claimed" after dormancy');
  }
  // Invariant 2: the seat always moves.
  if (r.to_agent && r.from_agent && r.to_agent === r.from_agent) {
    e.push("to_agent must differ from from_agent — a custody record that does not move the seat is invalid");
  }
  // Invariant 4: dormancy is a seat held by nobody, and it must say when it ends.
  if (r.to_agent === null) {
    if (r.reason !== "council_exhausted") {
      e.push('to_agent is null but reason is not "council_exhausted"');
    }
    if (!r.resume_at) {
      e.push("to_agent is null but resume_at is absent — a dormancy record must say when work can resume");
    }
  }

  if (r.budget !== undefined && r.budget !== null) {
    if (typeof r.budget !== "object") e.push("budget must be an object");
    else {
      const rf = r.budget.remaining_fraction;
      if (rf !== undefined && (!Number.isFinite(Number(rf)) || Number(rf) < 0 || Number(rf) > 1)) {
        e.push("budget.remaining_fraction must be a number between 0 and 1");
      }
      const ws = r.budget.window_seconds;
      if (ws !== undefined && (!Number.isFinite(Number(ws)) || Number(ws) <= 0)) {
        e.push("budget.window_seconds must be a positive number");
      }
    }
  }
  if (r.roster !== undefined) {
    if (!Array.isArray(r.roster)) e.push("roster must be an array");
    else {
      r.roster.forEach((m, i) => {
        if (!m || !m.agent) e.push(`roster[${i}].agent is required`);
        if (m && m.role !== undefined && !MEMBER_ROLES.includes(m.role)) {
          e.push(`roster[${i}].role must be one of: ${MEMBER_ROLES.join(", ")}`);
        }
        if (m && m.status !== undefined && !MEMBER_STATES.includes(m.status)) {
          e.push(`roster[${i}].status must be one of: ${MEMBER_STATES.join(", ")}`);
        }
      });
    }
  }
  if (r.open_decisions !== undefined) {
    if (!Array.isArray(r.open_decisions)) e.push("open_decisions must be an array");
    else r.open_decisions.forEach((d, i) => {
      if (typeof d !== "string" || !d) e.push(`open_decisions[${i}] must be a non-empty string`);
    });
  }
  if (r.falsifier !== undefined) e.push(...validateFalsifier(r.falsifier));

  // resume_at, when present alongside a roster, must be the earliest reset among
  // exhausted members: the first moment work CAN resume, not a guess about when
  // it should.
  if (r.resume_at && Array.isArray(r.roster)) {
    const resets = r.roster
      .filter((m) => m && m.status === "exhausted" && m.resets_at)
      .map((m) => m.resets_at)
      .sort();
    if (resets.length > 0 && r.resume_at !== resets[0]) {
      e.push(`resume_at (${r.resume_at}) must equal the earliest resets_at among exhausted roster members (${resets[0]})`);
    }
  }
  return e;
}

// Ledger-level check for invariant 1 (one seat). Pass the whole ledger; a single
// record cannot prove it. Returns the list of violations.
function validateCustodyChain(records, council) {
  const chain = records
    .filter((r) => r && r.record === "custody" && (council === undefined || r.council === council))
    .slice()
    .sort((a, b) => a.seat_epoch - b.seat_epoch);
  const e = [];
  const seen = new Set();
  let expected = 0;
  for (const r of chain) {
    if (seen.has(r.seat_epoch)) {
      e.push(`duplicate custody record at seat_epoch ${r.seat_epoch} (id: ${r.id}) — only the first appended is valid`);
      continue;
    }
    seen.add(r.seat_epoch);
    if (r.seat_epoch !== expected) {
      e.push(`seat_epoch gap: expected ${expected}, found ${r.seat_epoch} (id: ${r.id})`);
    }
    expected = r.seat_epoch + 1;
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
    case "delegation": return validateDelegationRecord(r);
    case "custody": return validateCustodyRecord(r);
    default: return [`unknown record type: "${r.record}" — must be decision, reconcile, outcome, delegation, or custody`];
  }
}

module.exports = {
  validateFalsifier,
  validateAggregate,
  validateDecisionRecord,
  validateReconcileRecord,
  validateOutcomeRecord,
  validateDelegationRecord,
  validateCustodyRecord,
  validateCustodyChain,
  validateRecord,
  FALSIFIER_TYPES,
  RECONSTRUCTION_CLASSES,
  RESOLUTION_STATES,
  OUTCOME_STATUSES,
  SUB_OUTCOME_STATUSES,
  RESOLUTION_POLICIES,
  CUSTODY_REASONS,
  MEMBER_ROLES,
  MEMBER_STATES
};
