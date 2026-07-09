# Open Receipt Format (ORF) — v0.6

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.5; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.5

One schema addition and two normative closures, all grounded in open questions named
explicitly in v0.5:

1. **`resolution_policy` on `aggregate`** — an optional field on the `aggregate` object
   (inside `outcome` records) that records which policy was applied at aggregate-write time.
   Makes aggregate records self-documenting: a reader can understand *why* a given
   `status` was produced from a given held/falsified breakdown without looking up the
   originating `decision`. Closes v0.5 open question #3 by providing the correct
   location: policy belongs on the *aggregate*, not on the *delegation*.

2. **`majority_held_is_success` threshold is fixed** — closes v0.5 open question #2.
   The threshold `held > falsified` is not configurable. If your domain requires a
   different threshold, use `resolution_policy: "custom"` and document the policy in
   the originating decision's `decision_rule` or the outcome's `notes`. A configurable
   threshold field would couple the aggregator to the decision at read time and replicate
   the problem `resolution_policy` was designed to solve.

3. **`resolution_policy` is NOT a `delegation` field** — closes v0.5 open question #3.
   Policy lives on `decision` (declared at decision time) and `aggregate` (recorded at
   outcome time). Sub-agents report honest status (`held`, `falsified`, `partial`);
   the orchestrator applies its own policy. Propagating the policy through `delegation`
   records would create unnecessary coupling between sub-agent behavior and orchestrator
   aggregation logic.

**Backward compatibility:** All v0.5 (and earlier) records remain valid v0.6 records.
The only schema change is:
- `resolution_policy` added as an **optional** field on `aggregate` — existing records
  without it are valid; its absence means the policy applied is unrecorded (consumers
  may need to look up the originating `decision`).
- `orf_version` enum extended to include `"0.6"` across all record types.

---

## Record Types

### `decision` (unchanged from v0.5)

No changes.

---

### `outcome` (updated in v0.6)

One new optional field on the nested `aggregate` object:

#### `aggregate.resolution_policy` (optional, new in v0.6)

Records which policy was applied when computing the `outcome.status` from the
`aggregate` breakdown. The field uses the same three-value enum as
`decision.resolution_policy`.

| Value | Meaning at aggregate-write time |
|---|---|
| `"any_falsified_is_failure"` | At least one sub-task was `falsified`; the overall status is `"falsified"` regardless of how many `held`. |
| `"majority_held_is_success"` | The threshold `held > falsified` was used to determine success. |
| `"custom"` | A domain-specific policy was applied; inspect `notes` for the rule. |

**When to set `aggregate.resolution_policy`:**

Set it when you want the aggregate record to be self-contained — readable without
looking up the originating `decision`. This is most useful in multi-agent pipelines
where the aggregate record may outlive or be separated from the originating decision.

It should match the originating `decision.resolution_policy` in most cases, but ORF
does not enforce this constraint: the aggregator may have applied a different policy
(for example, an override in the delegated task's context).

```json
{
  "orf_version": "0.6",
  "record": "outcome",
  "recorded_at": "2026-07-09T12:00:00Z",
  "decision_id": "batch-import-2026-07-09T10-00",
  "observed_result": "batch complete: 7 records imported, 2 failed validation",
  "falsifier_observed": null,
  "status": "held",
  "aggregate": {
    "total": 9,
    "held": 7,
    "falsified": 2,
    "undetermined": 0,
    "resolution_policy": "majority_held_is_success",
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

In this example, the aggregate is self-contained: `resolution_policy=majority_held_is_success`,
`held(7) > falsified(2)` → `status=held`. A reader needs no other record to understand
why the outcome is `held` despite two failures.

**`aggregate.resolution_policy` and `"any_falsified_is_failure"`:**

When the policy is `any_falsified_is_failure`, `outcome.status` will always be
`"falsified"` if `aggregate.falsified > 0`. Recording the policy makes this explicit:

```json
{
  "status": "falsified",
  "aggregate": {
    "total": 9,
    "held": 8,
    "falsified": 1,
    "undetermined": 0,
    "resolution_policy": "any_falsified_is_failure",
    "sub_outcomes": [...]
  }
}
```

A reader can see: "one failure out of nine, but the policy is all-or-nothing, so the
outcome is falsified."

---

### `reconcile` (unchanged from v0.5)

No changes.

---

### `delegation` (unchanged from v0.5)

No changes. `delegation` records now accept `orf_version: "0.6"` in addition to
earlier versions. `resolution_policy` is NOT added to `delegation` — see normative
closure #3 above.

---

## Migration from v0.5

**Reading v0.5 records in a v0.6 implementation:**

All v0.5 records are valid v0.6. No migration is required.

**Writing v0.6 records:**

Set `orf_version: "0.6"` in new records. Earlier records mixed into the same ledger
remain valid.

**Adopting `aggregate.resolution_policy`:**

- Add `resolution_policy` to `aggregate` objects when you want the aggregate to be
  self-contained.
- It should match the originating `decision.resolution_policy` when set.
- Omit it in aggregates where the policy is already on the decision and the reader
  will have access to both records.
- Old aggregates without it remain valid; their policy is implicitly `"custom"`.

---

## What ORF Still Does Not Solve

Items explicitly out of scope (updated from v0.5):

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
  sub-tasks at outcome-write time. Systems that stream results asynchronously need
  a different pattern; not yet specified.

---

## What Would Make This Better

1. **`resolution_policy` in practice** — does the three-value enum cover real
   domain policies, or do real orchestrators need a fourth value? Counter-examples
   welcome. (Unchanged from v0.5.)
2. **`aggregate.resolution_policy` consistency enforcement** — should ORF require
   `aggregate.resolution_policy` to match `decision.resolution_policy` when both
   are present? Currently the spec allows them to differ. A stricter rule would
   prevent silent policy drift but would complicate overrides.
3. **`partial` in `aggregate.partial` count (v0.4 open question #4)** — still open;
   needs real orchestrator implementations that produce nested `partial` outcomes.

---

## Versioning

This is `orf_version: "0.6"`. Backward-compatible additions (new optional fields,
new record types, enum extensions) increment the minor version. Breaking changes
(removing required fields, narrowing enum values) bump the major version.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
