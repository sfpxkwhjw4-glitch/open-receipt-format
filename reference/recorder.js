"use strict";

// Open Receipt Format (ORF) — reference implementation.
//
// One idea, developed to its conclusion: make every state change self-locating
// and replayable, classified by what cannot be rebuilt. Zero dependencies;
// append-only JSONL ledger. This implementation conforms to spec/orf-v0.10.md.
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

const ORF_VERSION = "0.10";
const RECONSTRUCTION_CLASSES = ["recomputable", "irrecoverable"];
const OUTCOME_STATES = ["held", "falsified", "undetermined", "partial", "in_progress"];
const FALSIFIER_TYPES = ["string", "uri", "predicate"];
const RESOLUTION_STATES = ["completed", "not_completed", "ambiguous"];
const RESOLUTION_POLICIES = ["any_falsified_is_failure", "majority_held_is_success", "custom"];
const CUSTODY_REASONS = [
  "seat_claimed", "budget_low", "budget_exhausted", "voluntary",
  "unresponsive", "preempted_by_user", "council_exhausted"
];
const MEMBER_ROLES = ["coordinator", "hand", "observer"];
const MEMBER_STATES = ["available", "exhausted", "unreachable", "onboarding"];

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

// --- Custody: the coordinator seat (v0.10) -----------------------------------

// A council is a set of peer agents, one of which holds the seat (the
// coordinator role) at a time. `delegation` records the vertical relationship
// (orchestrator -> sub-agent). `custody` records the horizontal one: the seat
// moving sideways from one peer to the next, or the council going dormant.
//
// The seat exists because budgets are per-member and finite. Four members with a
// five-hour window each are worth twenty member-hours only if the seat moves
// before each holder runs out AND the successor does not redo the predecessor's
// work. `open_decisions` plus the reconcile obligation is what buys the second.

function validateCustody(spec) {
  if (!spec || typeof spec !== "object") return ["custody spec must be an object"];
  const errors = [];
  if (!spec.id) errors.push("id is required");
  if (!spec.council) errors.push("council is required (it scopes seat_epoch)");

  const epoch = Number(spec.seat_epoch);
  if (!Number.isInteger(epoch) || epoch < 0) {
    errors.push("seat_epoch must be a non-negative integer");
  }
  if (spec.from_agent !== null && !spec.from_agent) {
    errors.push("from_agent is required (use null only when claiming an empty seat)");
  }
  if (spec.to_agent === undefined) {
    errors.push("to_agent is required (use null to record council dormancy)");
  }
  if (!CUSTODY_REASONS.includes(spec.reason)) {
    errors.push(`reason must be one of: ${CUSTODY_REASONS.join(", ")}`);
  }

  // Invariant 3: an empty seat is claimed, not transferred.
  if (spec.from_agent === null) {
    if (epoch !== 0 && spec.reason !== "seat_claimed") {
      errors.push('from_agent may be null only at seat_epoch 0, or with reason "seat_claimed" after dormancy');
    }
  }
  // Invariant 2: a handoff must actually move the seat.
  if (spec.to_agent && spec.from_agent && spec.to_agent === spec.from_agent) {
    errors.push("to_agent must differ from from_agent — a custody record that does not move the seat is invalid");
  }
  // Invariant 4: dormancy is a seat held by nobody, and it must say when it ends.
  if (spec.to_agent === null) {
    if (spec.reason !== "council_exhausted") {
      errors.push('to_agent is null but reason is not "council_exhausted" — a seat held by nobody means the council is out of budget');
    }
    if (!spec.resume_at) {
      errors.push("to_agent is null but resume_at is absent — a dormancy record must say when work can resume");
    }
  }

  if (spec.budget !== undefined && spec.budget !== null) {
    const rf = spec.budget.remaining_fraction;
    if (rf !== undefined && (!Number.isFinite(Number(rf)) || Number(rf) < 0 || Number(rf) > 1)) {
      errors.push("budget.remaining_fraction must be a number between 0 and 1");
    }
    const ws = spec.budget.window_seconds;
    if (ws !== undefined && (!Number.isFinite(Number(ws)) || Number(ws) <= 0)) {
      errors.push("budget.window_seconds must be a positive number");
    }
  }
  if (spec.roster !== undefined) {
    if (!Array.isArray(spec.roster)) errors.push("roster must be an array");
    else {
      spec.roster.forEach((m, i) => {
        if (!m || !m.agent) errors.push(`roster[${i}].agent is required`);
        if (m && m.role !== undefined && !MEMBER_ROLES.includes(m.role)) {
          errors.push(`roster[${i}].role must be one of: ${MEMBER_ROLES.join(", ")}`);
        }
        if (m && m.status !== undefined && !MEMBER_STATES.includes(m.status)) {
          errors.push(`roster[${i}].status must be one of: ${MEMBER_STATES.join(", ")}`);
        }
      });
    }
  }
  if (spec.open_decisions !== undefined && !Array.isArray(spec.open_decisions)) {
    errors.push("open_decisions must be an array of decision ids or orf:// URIs");
  }
  if (spec.falsifier !== undefined) errors.push(...validateFalsifier(spec.falsifier));
  return errors;
}

function buildCustody(spec, now) {
  const r = {
    orf_version: ORF_VERSION,
    record: "custody",
    recorded_at: now,
    id: spec.id,
    council: spec.council,
    seat_epoch: Number(spec.seat_epoch),
    from_agent: spec.from_agent === undefined ? null : spec.from_agent,
    to_agent: spec.to_agent === undefined ? null : spec.to_agent,
    reason: spec.reason
  };
  if (spec.budget) r.budget = spec.budget;
  if (spec.roster) r.roster = spec.roster;
  if (spec.open_decisions) r.open_decisions = asArray(spec.open_decisions);
  if (spec.resume_at) r.resume_at = spec.resume_at;
  if (spec.handoff_ledger) r.handoff_ledger = spec.handoff_ledger;
  if (spec.notes) r.notes = spec.notes;
  if (spec.falsifier !== undefined) r.falsifier = normalizeFalsifier(spec.falsifier);
  return r;
}

// Who holds the seat right now, per the ledger. Returns null before epoch 0 and
// after dormancy. Invariant 1 (one seat) is enforced on read: the first record
// appended at a given epoch wins, later ones at that epoch are ignored.
function currentSeat(ledger, council) {
  let best = null;
  const seen = new Set();
  for (const r of ledger) {
    if (r.record !== "custody") continue;
    if (council !== undefined && r.council !== council) continue;
    if (seen.has(r.seat_epoch)) continue; // first writer at this epoch wins
    seen.add(r.seat_epoch);
    if (best === null || r.seat_epoch > best.seat_epoch) best = r;
  }
  if (!best) return null;
  return { agent: best.to_agent, seat_epoch: best.seat_epoch, record: best };
}

// Verify invariant 1 across a ledger: seat_epoch increases by exactly 1 per
// custody record within a council. Returns the list of violations.
function validateCustodyChain(ledger, council) {
  const chain = ledger
    .filter((r) => r.record === "custody" && (council === undefined || r.council === council))
    .sort((a, b) => a.seat_epoch - b.seat_epoch);
  const errors = [];
  const seen = new Set();
  let expected = 0;
  for (const r of chain) {
    if (seen.has(r.seat_epoch)) {
      errors.push(`duplicate custody record at seat_epoch ${r.seat_epoch} (id: ${r.id}) — only the first appended is valid`);
      continue;
    }
    seen.add(r.seat_epoch);
    if (r.seat_epoch !== expected) {
      errors.push(`seat_epoch gap: expected ${expected}, found ${r.seat_epoch} (id: ${r.id})`);
    }
    expected = r.seat_epoch + 1;
  }
  return errors;
}

// Deterministic succession. Every member computes the same successor from the
// same roster, so a holder that dies mid-handoff does not strand the seat:
// greatest remaining_fraction, ties broken by earliest resets_at, then by
// lexicographically smallest agent id. Returns null when nobody is eligible.
function nextSeat(roster, outgoingAgent) {
  const eligible = (roster || []).filter(
    (m) => m && m.agent && m.agent !== outgoingAgent && m.role !== "observer" && m.status === "available"
  );
  if (eligible.length === 0) return null;
  const sorted = eligible.slice().sort((a, b) => {
    const fa = Number(a.remaining_fraction ?? 0);
    const fb = Number(b.remaining_fraction ?? 0);
    if (fb !== fa) return fb - fa;
    const ra = a.resets_at || "";
    const rb = b.resets_at || "";
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.agent < b.agent ? -1 : 1;
  });
  return sorted[0].agent;
}

// When can work resume? The earliest reset among exhausted members — not a guess
// about when work should resume, but the first moment it can.
function earliestReset(roster) {
  const resets = (roster || [])
    .filter((m) => m && m.status === "exhausted" && m.resets_at)
    .map((m) => m.resets_at)
    .sort();
  return resets[0] || null;
}

// --- Guarded instructions (v0.10) -------------------------------------------

// A guard is a query the reader runs against the ledger, not state the
// instruction author maintains. Resolve it before executing the step it guards.
//
//   [unless orf://council/step-3 is held] Do X.
//     ref = "orf://council/step-3", expectStatus = "held"
//
// Returns one of:
//   "skip"      — a receipt exists with the status the guard names; do not
//                 re-perform the step and do not write a second receipt for it
//   "execute"   — no receipt for this step exists; perform it
//   "reconcile" — a receipt exists but does not answer the guard (in_progress,
//                 undetermined, or a different final status). Write a reconcile
//                 record and act on its resolution. Never guess here: guessing
//                 "skip" drops work, guessing "execute" double-spends.
function resolveGuard(ledger, ref, expectStatus) {
  const want = expectStatus || "held";
  const id = String(ref || "").replace(/^orf:\/\/[^/]+\//, "");
  if (!id) return "execute";

  // A guard may name a decision id, a delegation id, or an action idempotency key.
  const decisionIds = new Set(
    ledger.filter((r) => r.record === "decision" && r.action_idempotency_key === id).map((r) => r.id)
  );
  if (ledger.some((r) => (r.record === "decision" || r.record === "delegation") && r.id === id)) {
    decisionIds.add(id);
  }
  if (decisionIds.size === 0) return "execute";

  const outcomes = ledger.filter((r) => r.record === "outcome" && decisionIds.has(r.decision_id));
  const final = outcomes.filter((o) => o.status !== "in_progress");
  if (final.some((o) => o.status === want)) return "skip";
  if (final.length > 0) return "reconcile"; // it ran, but not to the status the guard names

  // Decision recorded, nothing final closed it: the classic crash gap. An
  // existing reconcile record already answered this question — reuse its answer
  // rather than asking again.
  const rec = ledger.find((r) => r.record === "reconcile" && decisionIds.has(r.open_decision_id));
  if (rec) {
    if (rec.resolution === "completed") return "skip";
    if (rec.resolution === "not_completed") return "execute";
  }
  return "reconcile";
}

// Everything the incoming seat-holder must close before it may dispatch anything
// new. Empty list means the handoff is clean and forward work may start.
function unreconciled(ledger, custodyRecord) {
  const open = asArray(custodyRecord && custodyRecord.open_decisions);
  return open.filter((id) => {
    const bare = String(id).replace(/^orf:\/\/[^/]+\//, "");
    return !ledger.some(
      (r) => r.record === "reconcile" && (r.open_decision_id === id || r.open_decision_id === bare)
    );
  });
}

// --- Dormancy and wake (v0.10) ----------------------------------------------

// The dormancy custody record is the wake trigger. This mirrors it to a sidecar
// file so an ordinary scheduler can poll for it without parsing the ledger. The
// ledger record stays authoritative; the sidecar is a cache of it.
function writeWakeFile(file, custodyRecord) {
  if (custodyRecord.to_agent !== null) {
    throw new Error("wake file is written only for a dormancy record (to_agent: null)");
  }
  if (!custodyRecord.resume_at) {
    throw new Error("dormancy record has no resume_at — nothing to trigger on");
  }
  const wake = {
    orf_version: ORF_VERSION,
    council: custodyRecord.council,
    resume_at: custodyRecord.resume_at,
    seat_epoch: custodyRecord.seat_epoch,
    claim_seat_at_epoch: custodyRecord.seat_epoch + 1,
    dormancy_record_id: custodyRecord.id,
    open_decisions: asArray(custodyRecord.open_decisions),
    roster: custodyRecord.roster || []
  };
  fs.writeFileSync(file, `${JSON.stringify(wake, null, 2)}\n`);
  return wake;
}

// Is it time yet? Returns the wake payload when resume_at has passed, else null.
function readWakeFile(file, now) {
  if (!fs.existsSync(file)) return null;
  const wake = JSON.parse(fs.readFileSync(file, "utf8"));
  const at = now || new Date().toISOString();
  return wake.resume_at <= at ? wake : null;
}

// What the waking member does first — in order, before any new work. Nothing
// about waking is special: it is a handoff whose gap was measured in hours.
function resumePlan(ledger, council) {
  const seat = currentSeat(ledger, council);
  if (!seat) return { claim_seat_at_epoch: 0, reconcile_first: [], ready_to_dispatch: true };
  const pending = unreconciled(ledger, seat.record);
  return {
    claim_seat_at_epoch: seat.seat_epoch + 1,
    dormant: seat.agent === null,
    resume_at: seat.record.resume_at || null,
    reconcile_first: pending,
    ready_to_dispatch: pending.length === 0
  };
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
  CUSTODY_REASONS,
  MEMBER_ROLES,
  MEMBER_STATES,
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
  validateCustody,
  buildCustody,
  currentSeat,
  validateCustodyChain,
  nextSeat,
  earliestReset,
  resolveGuard,
  unreconciled,
  writeWakeFile,
  readWakeFile,
  resumePlan,
  appendRecord,
  loadLedger,
  findDecision
};
