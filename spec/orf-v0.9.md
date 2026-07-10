# Open Receipt Format (ORF) — v0.9

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.8; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.8

Two schema additions, one normative pattern, no breaking changes:

1. **`aggregate.pending`** (optional integer, ≥ 0) — count of sub-tasks that have been dispatched but whose results have not yet been received. When `pending > 0`, the aggregate is a checkpoint, not a final tally.

2. **`outcome.status: "in_progress"`** — new status value for checkpoint outcome records. An outcome with `status: "in_progress"` is not final; it records the state of a multi-agent cycle at a point in time.

3. **Extended total invariant** — the aggregate count constraint is now:
   ```
   total == held + falsified + undetermined + partial + pending
   ```
   For records without `aggregate.pending` (the common case), `pending` defaults to 0 and the existing constraint is unchanged.

4. **Checkpoint pattern** — normative guidance for streaming / async aggregation (closes the v0.8 open item). See below.

**Backward compatibility:** All v0.8 (and earlier) records remain valid v0.9 records. Existing records without `aggregate.pending` satisfy the extended invariant with `pending = 0`. The `in_progress` status is new; earlier records cannot have it.

---

## Checkpoint Pattern

The v0.8 `aggregate` model assumed all sub-tasks were known and resolved at outcome-write time. Real orchestrators often dispatch sub-agents in parallel and receive results asynchronously. The checkpoint pattern lets you write partial records as results arrive, then a final record when all are done.

### When to use it

Use the checkpoint pattern when:
- Your orchestrator dispatches N sub-agents in parallel (N known upfront).
- Results arrive at different times and you want to record progress.
- You want crash recovery visibility: if the orchestrator stops mid-run, the last checkpoint shows where things stood.

### Normative rules

- **A checkpoint record** (`status: "in_progress"`) MUST have `aggregate.pending > 0`. An `in_progress` record with `pending == 0` is invalid — if nothing is pending, write a final record.
- **A final record** (`status` ∈ {`held`, `falsified`, `undetermined`, `partial`}) MUST have `aggregate.pending == 0` (or `pending` absent). A final record with `pending > 0` is invalid.
- **Multiple outcome records for the same `decision_id`** are valid when using the checkpoint pattern. The single record with `status != "in_progress"` is the authoritative final outcome. Checkpoint records provide audit trail; they do not replace the final record.
- **`aggregate.sub_outcomes`** in a checkpoint record SHOULD include only resolved sub-tasks. Pending sub-tasks have no status to record. The `sub_outcomes` array SHOULD contain at least one entry (a checkpoint with zero resolved sub-tasks has nothing to show).
- **Unknown-total streaming** — when the total number of sub-tasks is not known at dispatch time — remains out of scope. Use a fixed `total` at dispatch time; the checkpoint pattern requires a known total.

### Worked example: three parallel sub-agents

An orchestrator dispatches three sub-agents (A, B, C) in parallel. Total = 3. Policy: `any_falsified_is_failure`.

**Decision record (at dispatch time):**
```json
{
  "orf_version": "0.9",
  "record": "decision",
  "recorded_at": "2026-07-10T10:00:00Z",
  "id": "parallel-batch-2026-07-10",
  "actor_agent": "orchestrator-v2",
  "intent": "Run three import sub-agents in parallel and aggregate results",
  "precondition_read": "import queue: 3 jobs pending",
  "decision_rule": "dispatch all, aggregate with any_falsified_is_failure",
  "action": "dispatch import-A, import-B, import-C",
  "confidence": 0.85,
  "falsifier": "any sub-agent exits with non-zero status",
  "reconstruction_class": "recomputable",
  "resolution_policy": "any_falsified_is_failure"
}
```

**Checkpoint 1 (sub-agent A resolves at T+30s):**
```json
{
  "orf_version": "0.9",
  "record": "outcome",
  "recorded_at": "2026-07-10T10:00:30Z",
  "decision_id": "parallel-batch-2026-07-10",
  "observed_result": "import-A: held (2,400 records imported); import-B and import-C still running",
  "falsifier_observed": null,
  "status": "in_progress",
  "aggregate": {
    "total": 3,
    "held": 1,
    "falsified": 0,
    "undetermined": 0,
    "partial": 0,
    "pending": 2,
    "resolution_policy": "any_falsified_is_failure",
    "sub_outcomes": [
      { "decision_id": "import-A", "status": "held" }
    ]
  }
}
```

**Checkpoint 2 (sub-agent B resolves at T+90s):**
```json
{
  "orf_version": "0.9",
  "record": "outcome",
  "recorded_at": "2026-07-10T10:01:30Z",
  "decision_id": "parallel-batch-2026-07-10",
  "observed_result": "import-A: held; import-B: held (1,800 records); import-C still running",
  "falsifier_observed": null,
  "status": "in_progress",
  "aggregate": {
    "total": 3,
    "held": 2,
    "falsified": 0,
    "undetermined": 0,
    "partial": 0,
    "pending": 1,
    "resolution_policy": "any_falsified_is_failure",
    "sub_outcomes": [
      { "decision_id": "import-A", "status": "held" },
      { "decision_id": "import-B", "status": "held" }
    ]
  }
}
```

**Final record (sub-agent C resolves at T+120s — falsified):**
```json
{
  "orf_version": "0.9",
  "record": "outcome",
  "recorded_at": "2026-07-10T10:02:00Z",
  "decision_id": "parallel-batch-2026-07-10",
  "observed_result": "import-A: held; import-B: held; import-C: exit code 1 (disk quota exceeded)",
  "falsifier_observed": true,
  "status": "falsified",
  "aggregate": {
    "total": 3,
    "held": 2,
    "falsified": 1,
    "undetermined": 0,
    "partial": 0,
    "pending": 0,
    "resolution_policy": "any_falsified_is_failure",
    "sub_outcomes": [
      { "decision_id": "import-A", "status": "held" },
      { "decision_id": "import-B", "status": "held" },
      { "decision_id": "import-C", "status": "falsified", "notes": "exit code 1: disk quota exceeded" }
    ]
  }
}
```

The two checkpoint records are valid and auditable. The final record is authoritative.

---

## Record Types

### `decision` (unchanged from v0.8)

No changes.

---

### `outcome` (new `in_progress` status and checkpoint pattern in v0.9)

Schema changes: `status` enum extended to include `"in_progress"`. No other field changes. `aggregate.pending` (see below) is the mechanism; `in_progress` is the signal.

Normative addition: see the Checkpoint Pattern section above.

---

### `aggregate` (new `pending` field in v0.9)

New optional field `pending` (integer, ≥ 0). When present, extends the total invariant:

```
total == held + falsified + undetermined + partial + pending
```

When absent (the common case), `pending` defaults to 0 and the existing constraint holds unchanged.

**`aggregate.sub_outcomes`** in a checkpoint record: only resolved sub-tasks appear. The array length will be `total - pending` at checkpoint time; at final-record time, length equals `total`.

---

### `reconcile` (minor extension in v0.9)

`reconcile.prior_outcome_status` now accepts `"in_progress"` in addition to the existing values. If an agent reconciles a decision whose prior outcome was a checkpoint (not final), `prior_outcome_status: "in_progress"` makes the reconcile self-documenting: the prior state was incomplete.

---

### `delegation` (unchanged from v0.8)

No changes.

---

## Migration from v0.8

**Reading v0.8 records in a v0.9 implementation:**

All v0.8 records are valid v0.9. No migration required. `pending` defaults to 0 for older records.

**Writing v0.9 records:**

Set `orf_version: "0.9"` in new records. Earlier records mixed into the same ledger remain valid.

**Adopting the checkpoint pattern:**

- If your orchestrator already waits for all sub-tasks before writing an outcome (the common case): no change needed. Your records are valid v0.9 as-is.
- If your orchestrator streams results: write checkpoint records with `status: "in_progress"` and `aggregate.pending > 0` as results arrive. Write a final record (normal status, `pending = 0`) when complete.

---

## What ORF Still Does Not Solve

Items explicitly out of scope:

- **Cryptographic signing** — still out of scope.
- **Agent identity verification** — `actor_agent` and `delegate_agent` remain free-form strings.
- **Multi-agent receipt chains** — chain traversal protocol remains an infrastructure concern; `delegation` records and `orf://` URIs provide the primitives.
- **Spend settlement** — the `settled` flag exists; full reconciliation protocol out of scope.
- **Schema evolution / migration tooling** — the `orf_version` field enables detection; automated migration is not yet specified.
- **Streaming with unknown total** — `aggregate.total` must be known at dispatch time. Systems where the total number of sub-tasks is not known upfront need a different pattern; not yet specified.

---

## What Would Make This Better

1. **`resolution_policy` in practice** — does the three-value enum cover real domain policies, or do real orchestrators need a fourth value? Counter-examples welcome. (Unchanged from v0.8.)

---

## Versioning

This is `orf_version: "0.9"`. Backward-compatible additions (new optional fields,
new record types, enum extensions) increment the minor version. Breaking changes
(removing required fields, narrowing enum values) bump the major version.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
