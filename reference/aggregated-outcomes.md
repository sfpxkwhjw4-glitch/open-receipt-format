# Aggregated Outcomes

When an orchestrator runs N tools or sub-agents in a single cycle, its outcome is
a composite of N results. Using `observed_result` as a free-form string — "3 of 5
held; 2 undetermined" — describes the situation but does not make it queryable.
Any tool that wants to count, filter, or trend aggregate success rates must parse
natural language.

This document proposes a structured `aggregate` field on the `outcome` record for
v0.3. It is optional and backward compatible: single-action outcomes work exactly
as before. Orchestrators that manage multiple parallel sub-tasks use `aggregate` to
express the breakdown in a machine-readable way.

---

## The problem

Pattern 2 from [`reference/orchestrator-patterns.md`](orchestrator-patterns.md)
shows an orchestrator running monitor and thread-replies tools in the same cycle.
The cycle outcome today:

```json
{
  "orf_version": "0.2",
  "record": "outcome",
  "recorded_at": "2026-06-28T15:53:15Z",
  "decision_id": "cycle-2026-06-28T15-53",
  "observed_result": "harvest complete: 2 tools held, 1 undetermined (inbound: network timeout)",
  "falsifier_observed": false,
  "status": "held"
}
```

A future agent reading this ledger knows, in prose, what happened. It cannot easily
ask: how often does the inbound tool return undetermined? What fraction of cycles have
at least one falsified sub-task? Are there correlated failures across sub-tools?

These are not exotic questions. A system that runs the same multi-tool cycle hundreds
of times eventually wants to answer them without parsing `observed_result` each time.

---

## The `aggregate` field

Add an optional `aggregate` field to the `outcome` record:

```json
{
  "orf_version": "0.2",
  "record": "outcome",
  "recorded_at": "2026-06-28T15:53:15Z",
  "decision_id": "cycle-2026-06-28T15-53",
  "observed_result": "harvest complete: 2 tools held, 1 undetermined (inbound: network timeout)",
  "falsifier_observed": false,
  "status": "held",
  "aggregate": {
    "total": 3,
    "held": 2,
    "falsified": 0,
    "undetermined": 1,
    "sub_outcomes": [
      {
        "decision_id": "harvest-monitor-2026-06-28T15-53",
        "status": "held"
      },
      {
        "decision_id": "harvest-replies-2026-06-28T15-53",
        "status": "held"
      },
      {
        "decision_id": "inbound-check-2026-06-28T15-53",
        "status": "undetermined",
        "notes": "network timeout on ORF repo check; not retried this cycle"
      }
    ]
  }
}
```

The `aggregate` field is a summary of sub-task results alongside a list of
individual outcomes with stable decision IDs that can be looked up in the
orchestrator's own ledger.

---

## Field definitions

**`aggregate` (optional object on `outcome`)**

| Field | Type | Description |
|---|---|---|
| `total` | integer | Total number of sub-tasks in this cycle |
| `held` | integer | Count of sub-tasks whose status is `held` |
| `falsified` | integer | Count of sub-tasks whose status is `falsified` |
| `undetermined` | integer | Count of sub-tasks whose status is `undetermined` |
| `sub_outcomes` | array | Per-sub-task detail (see below) |

**`sub_outcomes` entry:**

| Field | Type | Description |
|---|---|---|
| `decision_id` | string | The decision ID of this sub-task — looks up the record in the orchestrator's own ledger (or an `orf://` URI for cross-ledger references) |
| `status` | string | One of `held`, `falsified`, `undetermined` |
| `notes` | string | Optional. Reason for non-held status; not required for `held` |

The counts must sum to `total`. If `held + falsified + undetermined != total`, the
record is malformed.

---

## Setting the top-level `status`

The top-level `status` on the `outcome` record reflects the **orchestrator's overall
judgment**, not a mechanical rule. ORF does not impose a formula because partial
success means different things in different systems:

- 2 of 3 tools held, 1 undetermined — a monitoring cycle might call this `held`
  (the main read succeeded; an optional channel was unavailable).
- 4 of 5 sub-agents held, 1 falsified — a payment batch might call this `falsified`
  (any failure in a financial system is a failure).

The `aggregate` field exposes the components; the top-level `status` is the
orchestrator's call. The only rule: be consistent. If your system uses `held` for
"all held," define that policy and record it in your `decision_rule` field.

**Common patterns:**

```
All held     → status: "held"   (aggregate confirms it)
Any falsified → status: "falsified"  (common in high-integrity systems)
Majority held, none falsified, some undetermined → status: "held"
              (common in monitoring systems; document in decision_rule)
```

---

## Using `orf://` URIs in sub_outcomes

When sub-tasks are delegated to separate agents with their own ledgers (see
[`reference/delegation-record.md`](delegation-record.md)), the `decision_id` in
`sub_outcomes` should use the `orf://` URI scheme from
[`reference/cross-ledger.md`](cross-ledger.md):

```json
{
  "aggregate": {
    "total": 2,
    "held": 1,
    "falsified": 0,
    "undetermined": 1,
    "sub_outcomes": [
      {
        "decision_id": "orf://monitor-agent-socials/harvest-monitor-2026-06-28T15-53",
        "status": "held"
      },
      {
        "decision_id": "orf://inbound-sensor/inbound-check-2026-06-28T15-53",
        "status": "undetermined",
        "notes": "network timeout on ORF repo check"
      }
    ]
  }
}
```

For sub-tasks written to the same ledger as the orchestrator, a bare decision ID
is sufficient — the `orf://` prefix is only needed when dereferencing requires
looking up a different ledger.

---

## Working example

A harvest orchestrator runs three tools in parallel. Two succeed; the inbound
sensor times out. The orchestrator judges the cycle `held` (the primary sensors
worked; the optional forward sensor being unavailable is acceptable):

**Cycle decision:**

```json
{
  "orf_version": "0.2",
  "record": "decision",
  "id": "cycle-2026-06-28T15-53",
  "actor_agent": "founder-cycle",
  "intent": "Run harvest cycle — monitor, thread-replies, inbound",
  "decision_rule": "cycle is held if no primary sensor falsified; undetermined inbound is tolerated",
  "action": "parallel invoke: monitor-agent-socials.js, check-thread-replies.js, inbound.js",
  "confidence": 1.0,
  "falsifier": "any primary tool exits non-zero",
  "reconstruction_class": "recoverable"
}
```

**Cycle outcome:**

```json
{
  "orf_version": "0.2",
  "record": "outcome",
  "recorded_at": "2026-06-28T15:53:30Z",
  "decision_id": "cycle-2026-06-28T15-53",
  "observed_result": "harvest complete: monitor held (reply_count=16), replies held (total=111), inbound undetermined (network timeout)",
  "falsifier_observed": false,
  "status": "held",
  "aggregate": {
    "total": 3,
    "held": 2,
    "falsified": 0,
    "undetermined": 1,
    "sub_outcomes": [
      { "decision_id": "harvest-monitor-2026-06-28T15-53", "status": "held" },
      { "decision_id": "harvest-replies-2026-06-28T15-53", "status": "held" },
      {
        "decision_id": "inbound-check-2026-06-28T15-53",
        "status": "undetermined",
        "notes": "GET https://api.github.com/repos/... timed out after 5s; not retried"
      }
    ]
  }
}
```

A future agent or audit tool can now count undetermined inbound checks across cycles
by filtering: `record == "outcome" AND aggregate.sub_outcomes[?].decision_id contains "inbound-check"`.
No natural-language parsing required.

---

## What this does not solve

**Resolution policy.** ORF does not define what fraction of held sub-tasks constitutes
a held cycle. That is business logic. The `decision_rule` field on the cycle decision
is where the orchestrator should document its policy.

**Nested aggregates.** If a sub-agent itself produces an `aggregate` outcome, the
orchestrator does not automatically see the breakdown — it sees only the sub-agent's
top-level `status`. For multi-level orchestration, each level's aggregate is scoped
to that level's direct sub-tasks. Deep drill-down requires following `orf://` URIs to
each sub-ledger in turn.

**Stream vs. batch.** This proposal models a cycle with N known sub-tasks. A system
that streams results over time (sub-tasks completing asynchronously over minutes) will
not know the final counts at the time the orchestrator writes the outcome. For streaming
systems, an `aggregate_outcome` emitted after the last sub-task completes — rather than
inline on the cycle outcome — may be a better fit. This is a gap left for v0.3 discussion.

---

## Relationship to v0.3

This document addresses Gap #3 from
[`reference/orchestrator-patterns.md`](orchestrator-patterns.md). The three gaps are
now fully addressed:

1. Cross-ledger references — *(addressed in [`reference/cross-ledger.md`](cross-ledger.md))*
2. Delegation record type — *(addressed in [`reference/delegation-record.md`](delegation-record.md))*
3. Aggregated outcomes schema — *(this document)*

Together these three reference documents describe v0.3's structural additions: the
`orf://` URI scheme, the `delegation` record type, and the `aggregate` field on
`outcome`. None require changes to existing v0.2 records. All are additive and
backward compatible.

---

## Open questions

**1. Should the `aggregate` field be validated in conformance tests?**
Adding it to the conformance suite would require implementors to produce well-formed
aggregate counts or be declared non-conforming. This raises the barrier to conformance.
An alternative: conformance tests treat `aggregate` as optional and, if present, only
validate that `held + falsified + undetermined == total`. External validation
remains opt-in.

**2. Should `sub_outcomes` items be allowed to reference reconcile records, not just
decision records?** A sub-task that crashed and was recovered produces a `reconcile`
record as its conclusion. The orchestrator's aggregate might want to reference that
reconcile record instead of the original decision. The current proposal silently
supports this — `decision_id` can hold any ID — but does not name it explicitly.

**3. Should there be a first-class `partial` status?** An orchestrator that runs 10
sub-tasks and has 7 held and 3 falsified is not `held` (it failed some) and not
`falsified` (it succeeded some). Today the orchestrator must pick one and explain in
`observed_result`. A `partial` status would express this precisely, at the cost of
adding a new enum value that v0.2 consumers do not know.
