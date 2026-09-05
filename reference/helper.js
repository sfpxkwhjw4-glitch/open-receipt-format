"use strict";
// ORF v0.10 — drop-in helper. Zero dependencies. Copy into your project or require directly.
// Full spec: spec/orf-v0.10.md  Full reference: reference/recorder.js

const V = "0.10";
const RESOLUTION_POLICIES = ["any_falsified_is_failure", "majority_held_is_success", "custom"];
const CUSTODY_REASONS = [
  "seat_claimed", "budget_low", "budget_exhausted", "voluntary",
  "unresponsive", "preempted_by_user", "council_exhausted"
];
const now = () => new Date().toISOString();
const normF = (f) => (typeof f === "string" ? { type: "string", value: f } : f);
const diff = (f) => (f === true ? "falsified" : f === false ? "held" : "undetermined");

// Emit a decision receipt before acting.
// id       — unique within your ledger (also the receipt's idempotency key)
// opts.actor        — your agent's name or id
// opts.intent       — why you're acting (recorded at decision time)
// opts.precondition — what you actually read before deciding (not assumed)
// opts.rule         — the decision rule in force right now
// opts.action       — what you're about to do
// opts.falsifier    — string OR { type: "uri"|"predicate"|"string", value, window_seconds? }
// opts.confidence   — 0..1
// opts.reconClass   — "recomputable" | "irrecoverable"
// opts.idempotencyKey    — key for the side effect (separate from the receipt id)
// opts.resolutionPolicy  — "any_falsified_is_failure" | "majority_held_is_success" | "custom"
//                          (v0.5) declares how to interpret a partial outcome; omit for custom semantics
// opts.tags              — string[]
function decision(id, opts = {}) {
  const r = {
    orf_version: V, record: "decision", recorded_at: now(), id,
    actor_agent: opts.actor || "unknown",
    intent: opts.intent, precondition_read: opts.precondition,
    decision_rule: opts.rule, action: opts.action,
    confidence: Number(opts.confidence),
    falsifier: normF(opts.falsifier),
    reconstruction_class: opts.reconClass,
    spend: null, tags: opts.tags || []
  };
  if (opts.idempotencyKey) r.action_idempotency_key = opts.idempotencyKey;
  if (opts.resolutionPolicy) r.resolution_policy = opts.resolutionPolicy;
  return r;
}

// Emit a reconcile-on-wake record. Write on boot to close the crash gap.
// id                  — unique within your ledger
// opts.openDecisionId — the decision you are reconciling
// opts.worldStateRead — what you actually observed in the world on waking
// opts.gapDetected    — boolean: did the world differ from what the pre-sleep receipt promised?
// opts.resolution          — "completed" | "not_completed" | "ambiguous"
// opts.notes               — explanation when resolution is ambiguous
// opts.priorOutcomeStatus  — (v0.5) optional: "held"|"falsified"|"undetermined"|"partial"|"in_progress"
//                            records what was found on the prior outcome, making reconcile self-contained
//                            (v0.10) also used when reconciling a predecessor's open_decisions after a seat handoff
function reconcile(id, opts = {}) {
  const r = {
    orf_version: V, record: "reconcile", recorded_at: now(), id,
    open_decision_id: opts.openDecisionId,
    world_state_read: opts.worldStateRead,
    gap_detected: opts.gapDetected, resolution: opts.resolution,
    notes: opts.notes || ""
  };
  if (opts.priorOutcomeStatus) r.prior_outcome_status = opts.priorOutcomeStatus;
  return r;
}

// Emit an outcome once the falsifier can be checked.
// decisionId              — the decision this outcome closes
// opts.observedResult     — what you observed
// opts.falsifierObserved  — true (falsified) | false (held) | null (undetermined or partial)
// opts.status             — explicit override: "partial" when aggregate shows held>0 AND falsified>0
//                           (v0.4); "in_progress" (v0.9) for checkpoint records when pending > 0;
//                           omit to derive from falsifierObserved
// opts.notes              — (v0.7) optional string; SHOULD document policy divergence or partial treatment
// opts.aggregate          — optional structured breakdown for multi-tool cycles
//   { total, held, falsified, undetermined, partial?, pending?, resolution_policy?,
//     sub_outcomes: [{decision_id, status, notes?}] }
//   aggregate.pending        — (v0.9) sub-tasks dispatched but not yet resolved;
//                              extends total invariant: held+falsified+undetermined+partial+pending==total
//   aggregate.resolution_policy  — (v0.6) "any_falsified_is_failure" | "majority_held_is_success" | "custom"
//                                  records which policy determined outcome.status from the breakdown
function outcome(decisionId, opts = {}) {
  const f = opts.falsifierObserved === undefined ? null : opts.falsifierObserved;
  const r = {
    orf_version: V, record: "outcome", recorded_at: now(),
    decision_id: decisionId, observed_result: opts.observedResult,
    falsifier_observed: f, status: opts.status || diff(f), artifacts: []
  };
  if (opts.notes) r.notes = opts.notes;
  if (opts.aggregate) r.aggregate = opts.aggregate;
  return r;
}

// Emit a delegation receipt before invoking a sub-agent. New in v0.3.
// id                    — unique within your orchestrator's ledger
// opts.delegatingAgent  — your orchestrator's name or id
// opts.delegateAgent    — the sub-agent being invoked
// opts.delegatedIntent  — what you instructed the sub-agent to do
// opts.delegateLedger   — orf:// URI for the sub-agent's own ledger (optional)
// opts.parentDecisionId — the orchestrator's cycle decision id (optional)
// opts.idempotencyKey   — invocation idempotency key (optional)
// opts.falsifier        — condition indicating the sub-agent failed (optional)
function delegation(id, opts = {}) {
  const r = {
    orf_version: V, record: "delegation", recorded_at: now(), id,
    delegating_agent: opts.delegatingAgent || "unknown",
    delegate_agent: opts.delegateAgent || "unknown",
    delegated_intent: opts.delegatedIntent
  };
  if (opts.delegateLedger) r.delegate_ledger = opts.delegateLedger;
  if (opts.parentDecisionId) r.parent_decision_id = opts.parentDecisionId;
  if (opts.idempotencyKey) r.action_idempotency_key = opts.idempotencyKey;
  if (opts.falsifier !== undefined) r.falsifier = normF(opts.falsifier);
  return r;
}

// Emit a custody receipt when the coordinator seat moves. New in v0.10.
// `delegation` is vertical (orchestrator -> sub-agent); `custody` is horizontal
// (peer -> peer). Write one before you run out of budget, not after.
// id                   — unique within the council ledger
// opts.council         — council name; scopes seatEpoch
// opts.seatEpoch       — integer, previous epoch + 1 (fences the seat)
// opts.from            — outgoing holder; null only when claiming an empty seat
// opts.to              — incoming holder; null records council dormancy
// opts.reason          — "seat_claimed" | "budget_low" | "budget_exhausted" | "voluntary"
//                        | "unresponsive" | "preempted_by_user" | "council_exhausted"
// opts.budget          — { window_seconds, remaining_fraction, resets_at, unit? }
// opts.roster          — [{ agent, role, status, resets_at, remaining_fraction, capabilities? }]
// opts.openDecisions   — ids/orf:// URIs the successor MUST reconcile before dispatching
// opts.resumeAt        — required when `to` is null: earliest resets_at among exhausted members
// opts.handoffLedger   — orf:// URI where the successor writes, if different
// opts.notes           — explanation; expected for "unresponsive"/"preempted_by_user"
// opts.falsifier       — what would show the handoff failed
function custody(id, opts = {}) {
  const r = {
    orf_version: V, record: "custody", recorded_at: now(), id,
    council: opts.council,
    seat_epoch: Number(opts.seatEpoch),
    from_agent: opts.from === undefined ? null : opts.from,
    to_agent: opts.to === undefined ? null : opts.to,
    reason: opts.reason
  };
  if (opts.budget) r.budget = opts.budget;
  if (opts.roster) r.roster = opts.roster;
  if (opts.openDecisions) r.open_decisions = opts.openDecisions;
  if (opts.resumeAt) r.resume_at = opts.resumeAt;
  if (opts.handoffLedger) r.handoff_ledger = opts.handoffLedger;
  if (opts.notes) r.notes = opts.notes;
  if (opts.falsifier !== undefined) r.falsifier = normF(opts.falsifier);
  return r;
}

// Deterministic succession (v0.10): greatest remaining_fraction among eligible
// members, ties by earliest resets_at, then by smallest agent id. Every member
// computes the same answer, so a holder that dies mid-handoff strands nothing.
// Returns null when no member is eligible — that is the dormancy signal.
function nextSeat(roster, outgoing) {
  const eligible = (roster || []).filter(
    (m) => m && m.agent && m.agent !== outgoing && m.role !== "observer" && m.status === "available"
  );
  if (!eligible.length) return null;
  return eligible.slice().sort((a, b) =>
    (Number(b.remaining_fraction ?? 0) - Number(a.remaining_fraction ?? 0)) ||
    String(a.resets_at || "").localeCompare(String(b.resets_at || "")) ||
    String(a.agent).localeCompare(String(b.agent))
  )[0].agent;
}

module.exports = { decision, reconcile, outcome, delegation, custody, nextSeat, RESOLUTION_POLICIES, CUSTODY_REASONS };
