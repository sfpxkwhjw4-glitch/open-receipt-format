# Open Receipt Format (ORF) — v0.8

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.7; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.7

One normative closure, no new schema fields:

1. **`partial` sub-outcomes under `resolution_policy`** — closes v0.7 open question #2. When a sub-task has `status: "partial"` in `sub_outcomes` (meaning it was itself an orchestrator with mixed results), the applying `resolution_policy` now has normative rules for how to treat that count:

   - **`any_falsified_is_failure`**: If `aggregate.partial > 0`, the aggregate outcome SHOULD be `status: "falsified"`. Rationale: `partial` at the sub-task level means at least one component within that sub-task was falsified. Under a policy where any falsification fails the aggregate, the partial's implied falsification propagates upward. If the orchestrator has strong reasons to treat partial as non-failure (e.g., the sub-task's falsified components were known-optional), record the override in `outcome.notes`.

   - **`majority_held_is_success`**: `partial` sub-outcomes are excluded from the majority calculation. The rule applies to `held` vs `falsified` counts only: `held > falsified → held`; `held == falsified → undetermined`; `held < falsified → falsified`. If `aggregate.partial > 0`, SHOULD note the exclusion in `outcome.notes` so consumers know the majority was computed over a reduced pool.

   - **`custom`**: The implementor defines how `partial` sub-outcomes are treated. SHOULD document the treatment in `outcome.notes`.

   The conservative default: when in doubt, `partial` counts as a non-success — it neither contributes to the "held" side of a majority calculation, nor escapes a `any_falsified_is_failure` policy.

**Backward compatibility:** All v0.7 (and earlier) records remain valid v0.8 records. The only schema change is `orf_version` enum extended to include `"0.8"`.

---

## Record Types

### `decision` (unchanged from v0.7)

No changes.

---

### `outcome` (normative clarification in v0.8)

No schema changes. Normative addition: when applying `resolution_policy` to an aggregate that includes `partial` sub-outcomes, use the rules above and document any non-default treatment in `outcome.notes`.

#### `partial` sub-outcomes — worked examples

**Example 1: `any_falsified_is_failure` + one partial sub-task**

A top-level orchestrator runs three sub-agents. One is itself an orchestrator that ran 5 leaf tasks: 3 held, 2 falsified — so it reported `partial`. The top-level policy is `any_falsified_is_failure`.

```json
{
  "orf_version": "0.8",
  "record": "outcome",
  "recorded_at": "2026-07-10T08:00:00Z",
  "decision_id": "batch-top-2026-07-10",
  "observed_result": "batch: 2 sub-agents held, 1 partial (import-stage-b had 3/5 held)",
  "falsifier_observed": true,
  "status": "falsified",
  "aggregate": {
    "total": 3,
    "held": 2,
    "falsified": 0,
    "undetermined": 0,
    "partial": 1,
    "resolution_policy": "any_falsified_is_failure",
    "sub_outcomes": [
      { "decision_id": "import-stage-a", "status": "held" },
      { "decision_id": "import-stage-b", "status": "partial",
        "notes": "3/5 leaf tasks held, 2 falsified" },
      { "decision_id": "import-stage-c", "status": "held" }
    ]
  }
}
```

`partial > 0` triggers failure under `any_falsified_is_failure`. The top-level `status` is `falsified` even though no sub-outcome is directly `falsified`.

**Example 2: `majority_held_is_success` + one partial sub-task**

Five sub-agents. Three held, one falsified, one partial. Policy: `majority_held_is_success`. The majority is computed over held(3) vs falsified(1) only — the partial is excluded.

```json
{
  "orf_version": "0.8",
  "record": "outcome",
  "recorded_at": "2026-07-10T08:30:00Z",
  "decision_id": "batch-top-2026-07-10-b",
  "observed_result": "batch: 3 held, 1 falsified, 1 partial; majority held (3>1 over 4 clear outcomes)",
  "falsifier_observed": false,
  "status": "held",
  "notes": "majority_held_is_success applied over 4 clear sub-outcomes (1 partial excluded from calculation)",
  "aggregate": {
    "total": 5,
    "held": 3,
    "falsified": 1,
    "undetermined": 0,
    "partial": 1,
    "resolution_policy": "majority_held_is_success",
    "sub_outcomes": [
      { "decision_id": "stage-a", "status": "held" },
      { "decision_id": "stage-b", "status": "held" },
      { "decision_id": "stage-c", "status": "falsified",
        "notes": "external API timeout" },
      { "decision_id": "stage-d", "status": "held" },
      { "decision_id": "stage-e", "status": "partial",
        "notes": "7/10 leaf tasks held, 3 falsified" }
    ]
  }
}
```

Majority computed over 4 (not 5): held(3) > falsified(1) → `held`. The exclusion of the partial is noted in `outcome.notes`.

---

### `reconcile` (unchanged from v0.7)

No changes. `reconcile` records accept `orf_version: "0.8"` in addition to earlier versions.

---

### `delegation` (unchanged from v0.7)

No changes. `delegation` records accept `orf_version: "0.8"` in addition to earlier versions.

---

## Migration from v0.7

**Reading v0.7 records in a v0.8 implementation:**

All v0.7 records are valid v0.8. No migration required.

**Writing v0.8 records:**

Set `orf_version: "0.8"` in new records. Earlier records mixed into the same ledger remain valid.

**Adopting partial sub-outcome treatment:**

- If your aggregates never contain `partial` sub-outcomes (the common case for single-level orchestration): no change needed.
- If your aggregates contain `partial` sub-outcomes under `any_falsified_is_failure`: treat them as failure; `status: "falsified"`.
- If your aggregates contain `partial` sub-outcomes under `majority_held_is_success`: exclude from majority calculation; note the exclusion in `outcome.notes`.
- If using `custom`: define and document your treatment.

---

## What ORF Still Does Not Solve

Items explicitly out of scope (unchanged from v0.7):

- **Cryptographic signing** — still out of scope.
- **Agent identity verification** — `actor_agent` and `delegate_agent` remain free-form strings.
- **Multi-agent receipt chains** — chain traversal protocol remains an infrastructure concern; `delegation` records and `orf://` URIs provide the primitives.
- **Spend settlement** — the `settled` flag exists; full reconciliation protocol out of scope.
- **Schema evolution / migration tooling** — the `orf_version` field enables detection; automated migration is not yet specified.
- **Streaming / async aggregation** — `aggregate` models a cycle with N known sub-tasks at outcome-write time. Systems that stream results asynchronously need a different pattern; not yet specified.

---

## What Would Make This Better

1. **`resolution_policy` in practice** — does the three-value enum cover real domain policies, or do real orchestrators need a fourth value? Counter-examples welcome. (Unchanged from v0.7.)

---

## Versioning

This is `orf_version: "0.8"`. Backward-compatible additions (new optional fields,
new record types, enum extensions) increment the minor version. Breaking changes
(removing required fields, narrowing enum values) bump the major version.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
