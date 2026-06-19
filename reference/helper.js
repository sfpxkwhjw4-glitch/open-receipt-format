"use strict";
// ORF v0.2 — drop-in helper. Zero dependencies. Copy into your project or require directly.
// Full spec: spec/orf-v0.2.md  Full reference: reference/recorder.js

const V = "0.2";
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
// opts.idempotencyKey — key for the side effect (separate from the receipt id)
// opts.tags         — string[]
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
  return r;
}

// Emit a reconcile-on-wake record. Write on boot to close the crash gap.
// id                  — unique within your ledger
// opts.openDecisionId — the decision you are reconciling
// opts.worldStateRead — what you actually observed in the world on waking
// opts.gapDetected    — boolean: did the world differ from what the pre-sleep receipt promised?
// opts.resolution     — "completed" | "not_completed" | "ambiguous"
// opts.notes          — explanation when resolution is ambiguous
function reconcile(id, opts = {}) {
  return {
    orf_version: V, record: "reconcile", recorded_at: now(), id,
    open_decision_id: opts.openDecisionId,
    world_state_read: opts.worldStateRead,
    gap_detected: opts.gapDetected, resolution: opts.resolution,
    notes: opts.notes || ""
  };
}

// Emit an outcome once the falsifier can be checked.
// decisionId           — the decision this outcome closes
// opts.observedResult  — what you observed
// opts.falsifierObserved — true (falsified) | false (held) | null (undetermined)
function outcome(decisionId, opts = {}) {
  const f = opts.falsifierObserved === undefined ? null : opts.falsifierObserved;
  return {
    orf_version: V, record: "outcome", recorded_at: now(),
    decision_id: decisionId, observed_result: opts.observedResult,
    falsifier_observed: f, status: diff(f), artifacts: []
  };
}

module.exports = { decision, reconcile, outcome };
