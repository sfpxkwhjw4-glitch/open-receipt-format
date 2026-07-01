# Open Receipt Format (ORF) — v0.4

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.3; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.3

One targeted addition, grounded in a gap that surfaced when running multi-agent
cycles: the inability to accurately represent mixed outcomes.

1. **`partial` outcome status** — a first-class status for the case where some
   sub-tasks held and some falsified. Previously, orchestrators had to pick `held`
   or `falsified` and explain the mixed result in `observed_result`. v0.4 makes
   this machine-readable.

   This is the minor increment the v0.3 spec deferred pending feedback: "adding
   it now would break v0.2 consumers that do not know the new enum value." The
   addition is made in v0.4 because the `aggregate` field (added in v0.3) now
   provides the machine-readable components; `partial` closes the loop by making
   the top-level status equally machine-readable.

**Backward compatibility note:** All v0.3 (and v0.1, v0.2) records remain valid
v0.4 records. The only change is an **enum extension**: `partial` is added to
`outcome.status` and `sub_outcome.status`. Implementations that validate these
enums strictly will need to add `"partial"` to their allowlists. Records that
use `"held"`, `"falsified"`, or `"undetermined"` require no change.

---

## Record Types

### `decision` (unchanged from v0.3)

No changes.

---

### `outcome` (updated in v0.4)

Changes from v0.3:
- `status` enum adds `"partial"`: use when both `held > 0` **and** `falsified > 0`
  in the `aggregate` field
- `aggregate.partial` — new optional integer count for sub-tasks with status
  `partial` (from nested orchestrators); invariant updated accordingly

#### When to use `partial`

Use `partial` when:
- The `aggregate` field shows `held > 0` AND `falsified > 0` (mixed results)
- You want the top-level status to be machine-readable, not inferred from prose

Do **not** use `partial` when:
- All sub-tasks succeeded (`held` everywhere) → use `held`
- Any falsified result is a hard failure for your domain → use `falsified`
- Sub-tasks are still running → use `undetermined`

The guidance from v0.3 ("pick `held` or `falsified` and explain in
`observed_result`") remains valid — `partial` is additive, not mandatory. If your
policy treats any falsification as a total failure, `falsified` is still correct.

#### `falsifier_observed` with `partial`

When `status` is `partial`, set `falsifier_observed` to `null`. The top-level
falsifier was neither fully triggered (`true`) nor fully avoided (`false`). The
`aggregate` field carries the per-task breakdown.

```json
{
  "orf_version": "0.4",
  "record": "outcome",
  "recorded_at": "2026-07-01T09:00:00Z",
  "decision_id": "batch-2026-07-01T09-00",
  "observed_result": "batch complete: 7 records imported, 2 failed validation",
  "falsifier_observed": null,
  "status": "partial",
  "aggregate": {
    "total": 9,
    "held": 7,
    "falsified": 2,
    "undetermined": 0,
    "sub_outcomes": [
      { "decision_id": "import-record-1", "status": "held" },
      { "decision_id": "import-record-2", "status": "held" },
      { "decision_id": "import-record-3", "status": "falsified",
        "notes": "schema validation failed: missing required field 'amount'" },
      { "decision_id": "import-record-4", "status": "held" },
      { "decision_id": "import-record-5", "status": "held" },
      { "decision_id": "import-record-6", "status": "falsified",
        "notes": "duplicate key: idempotency_key already present in ledger" },
      { "decision_id": "import-record-7", "status": "held" },
      { "decision_id": "import-record-8", "status": "held" },
      { "decision_id": "import-record-9", "status": "held" }
    ]
  }
}
```

**Updated optional fields:**

| Field | Type | Description |
|---|---|---|
| `aggregate` | object | Structured breakdown (updated: `partial` count added) |

---

### `reconcile` (unchanged from v0.3)

No changes.

---

### `delegation` (unchanged from v0.3)

No changes. `delegation` records now accept `orf_version: "0.4"` in addition to
`"0.3"`.

---

## Aggregated Outcomes (updated in v0.4)

The `aggregate` struct adds an optional `partial` count for sub-tasks that are
themselves partial orchestrators.

**`aggregate` (optional object):**

| Field | Type | Description |
|---|---|---|
| `total` | integer ≥ 1 | Total number of sub-tasks in this cycle |
| `held` | integer ≥ 0 | Count of sub-tasks with status `held` |
| `falsified` | integer ≥ 0 | Count of sub-tasks with status `falsified` |
| `undetermined` | integer ≥ 0 | Count of sub-tasks with status `undetermined` |
| `partial` | integer ≥ 0 | **New.** Count of sub-tasks with status `partial`; omit or set to 0 for v0.3-compatible records |
| `sub_outcomes` | array | Per-sub-task detail (see below) |

Invariant: `held + falsified + undetermined + (partial ?? 0) == total`.

**Each `sub_outcomes` entry:**

| Field | Type | Description |
|---|---|---|
| `decision_id` | string | Decision ID of this sub-task, or an `orf://` URI for cross-ledger sub-tasks |
| `status` | string | One of `held`, `falsified`, `undetermined`, **`partial`** (new) |
| `notes` | string | Optional. Explanation for non-`held` status |

`partial` in `sub_outcomes` arises when a sub-agent is itself an orchestrator
that returned `partial`. The parent's aggregate can then record the component
count accurately.

---

## Migration from v0.3

**Reading v0.3 records in a v0.4 implementation:**

All v0.3 records are valid v0.4. No migration is required.

**Writing v0.4 records:**

Set `orf_version: "0.4"` in new records. v0.3 (and earlier) records mixed into
the same ledger remain valid.

**Adopting `partial`:**

- Use `partial` when `aggregate.held > 0` AND `aggregate.falsified > 0` and you
  want the top-level status to reflect the mixed result rather than a policy
  judgment.
- Set `falsifier_observed: null` when `status: "partial"`.
- Add `"partial"` to any enum allowlist that validates `outcome.status` or
  `sub_outcome.status`.

**Strict enum validators:**

If your implementation validates `outcome.status` against an allowlist, add
`"partial"` to that list. This is the only schema change that requires an update
to existing consumers. Records that do not use `partial` are unaffected.

---

## What ORF Still Does Not Solve

Items explicitly out of scope (updated from v0.3):

- **Cryptographic signing** — still out of scope.
- **Agent identity verification** — `actor_agent` and `delegate_agent` remain
  free-form strings.
- **Multi-agent receipt chains** — chain traversal protocol remains an
  infrastructure concern; `delegation` records and `orf://` URIs provide the
  primitives.
- **Spend settlement** — the `settled` flag exists; full reconciliation protocol
  out of scope.
- **Schema evolution / migration tooling** — the `orf_version` field enables
  detection; automated migration is not yet specified.
- **Streaming / async aggregation** — `aggregate` models a cycle with N known
  sub-tasks at outcome-write time. Systems that stream results asynchronously
  need a different pattern; not yet specified.

---

## What Would Make This Better

1. **`partial` in practice** — real orchestrators that have shipped with `partial`
   status. Does the `(falsifier_observed: null, status: "partial")` convention
   hold up, or do you need a distinct `falsifier_observed` value?
2. **Policy encoding** — `partial` shifts the burden to the consumer to interpret
   what "some held, some falsified" means for their domain. Should ORF add a
   `resolution_policy` field on `decision` to make the policy machine-readable?
   ("any_falsified_is_failure" vs "majority_held_is_success" vs "custom")
3. **`partial` in `reconcile`** — if a `partial` outcome is found on wake,
   what is the right reconcile resolution? `ambiguous` is a safe default;
   counter-examples welcome.
4. **Aggregate `partial` count in practice** — nested `partial` orchestrators
   create a `partial` sub-outcome entry. Is the count field (vs. scanning
   `sub_outcomes` for partial entries) useful enough to warrant the schema
   addition, or is it noise?

---

## Versioning

This is `orf_version: "0.4"`. Backward-compatible additions (new optional fields,
new record types, enum extensions) increment the minor version. Breaking changes
(removing required fields, narrowing enum values) bump the major version.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
