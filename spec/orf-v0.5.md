# Open Receipt Format (ORF) — v0.5

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.4; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.4

Two targeted additions, both grounded in open questions named explicitly in v0.4:

1. **`resolution_policy` on `decision`** — an optional field that makes a domain's
   failure policy machine-readable at decision time. Closes v0.4 open question #2:
   "Should ORF add a `resolution_policy` field on `decision` to make the policy
   machine-readable?" When a `partial` outcome is produced, consumers previously had
   to inspect the `aggregate` breakdown and apply implicit domain rules. `resolution_policy`
   makes those rules explicit and queryable.

2. **Normative `partial` reconcile guidance** — closes v0.4 open question #3:
   "If a `partial` outcome is found on wake, what is the right reconcile resolution?"
   The answer: use `resolution: "ambiguous"` when the prior outcome is `partial`,
   unless the original `decision` has a `resolution_policy` that provides a
   deterministic interpretation. This converts a heuristic ("ambiguous is a safe
   default") into a normative rule with a stated exception.

**Backward compatibility:** All v0.4 (and earlier) records remain valid v0.5 records.
The only schema changes are:
- `resolution_policy` added as an **optional** field on `decision` — existing records
  without it are valid; its absence means the policy is `"custom"` (consumer decides).
- `orf_version` enum extended to include `"0.5"` across all record types. Records
  that use earlier version strings remain valid.

---

## Record Types

### `decision` (updated in v0.5)

One new optional field:

#### `resolution_policy` (optional)

Declares how the domain interprets a `partial` outcome from this decision. Three
encoded values; the field is optional (treat its absence as `"custom"`).

| Value | Meaning |
|---|---|
| `"any_falsified_is_failure"` | A single falsified sub-task makes the whole decision `falsified`, regardless of how many held. |
| `"majority_held_is_success"` | If `aggregate.held > aggregate.falsified`, treat the outcome as `held`. If equal, treat as `ambiguous` (use `resolution: "ambiguous"` in reconcile). |
| `"custom"` | No encoded policy. The consumer must inspect `aggregate` and apply domain rules. Equivalent to omitting the field. |

```json
{
  "orf_version": "0.5",
  "record": "decision",
  "recorded_at": "2026-07-09T10:00:00Z",
  "id": "batch-import-2026-07-09T10-00",
  "actor_agent": "import-orchestrator",
  "intent": "Import 9 validated records into the ledger",
  "precondition_read": "GET /ledger/status — writable; 0 pending imports",
  "decision_rule": "import all records that pass schema validation; skip invalid with notes",
  "action": "POST /ledger/batch with 9-record payload",
  "confidence": 0.9,
  "falsifier": "any record that passes validation is not present in ledger within 30s",
  "reconstruction_class": "recomputable",
  "resolution_policy": "majority_held_is_success"
}
```

**When to set `resolution_policy`:**

Set it when your domain has a defined policy for mixed results. A batch import that
tolerates individual failures ("7 of 9 is still success") should use
`"majority_held_is_success"`. A payment orchestrator that treats any single failure
as a total rollback should use `"any_falsified_is_failure"`. If the policy is not
yet defined or varies by context, omit the field or use `"custom"`.

**`resolution_policy` and `partial` outcomes:**

When a `partial` outcome is recorded for this decision (see v0.4 spec), a consumer
reading the pair (decision + outcome) can now derive the effective resolution:

- `"any_falsified_is_failure"` + `partial` → effective status is `"falsified"`
- `"majority_held_is_success"` + `partial` → inspect `aggregate.held` vs `aggregate.falsified`:
  - `held > falsified` → effective status is `"held"`
  - `held == falsified` → use `"ambiguous"` in reconcile
  - `held < falsified` → effective status is `"falsified"`
- `"custom"` (or absent) + `partial` → consumer applies its own logic

---

### `outcome` (unchanged from v0.4)

No changes.

---

### `reconcile` (updated in v0.5)

**Normative guidance for `partial` prior outcomes:**

When a reconciler wakes and finds that the open decision's most recent outcome has
`status: "partial"`, the following rule applies:

> Use `resolution: "ambiguous"` **unless** the original `decision` has a
> `resolution_policy` that provides a deterministic interpretation.

Concretely:

| Prior outcome status | `decision.resolution_policy` | Use reconcile `resolution` |
|---|---|---|
| `partial` | absent or `"custom"` | `"ambiguous"` |
| `partial` | `"any_falsified_is_failure"` | `"not_completed"` (treat as falsified — safe to retry with idempotency key) |
| `partial` | `"majority_held_is_success"` and `held > falsified` | `"completed"` |
| `partial` | `"majority_held_is_success"` and `held == falsified` | `"ambiguous"` |
| `partial` | `"majority_held_is_success"` and `held < falsified` | `"not_completed"` |
| `held` | any | `"completed"` |
| `falsified` | any | `"not_completed"` |
| `undetermined` | any | `"ambiguous"` |

No schema changes to the `reconcile` record type. The resolution enum
(`"completed"`, `"not_completed"`, `"ambiguous"`) is unchanged — `"ambiguous"` was
already the right value for `partial` in the absence of an encoded policy.

The new normative rule converts a v0.4 heuristic ("ambiguous is a safe default")
into a table with deterministic cases for `resolution_policy`-bearing decisions.

**Optional `prior_outcome_status` field (new in v0.5):**

A reconcile record may include the observed outcome status to make the reconcile
reasoning self-contained (useful for audit, without requiring the reader to locate
and re-read the outcome record):

```json
{
  "orf_version": "0.5",
  "record": "reconcile",
  "recorded_at": "2026-07-09T11:00:00Z",
  "id": "reconcile-batch-import-2026-07-09T11-00",
  "open_decision_id": "batch-import-2026-07-09T10-00",
  "world_state_read": "GET /ledger/batch-import-2026-07-09T10-00/outcome — status=partial; held=7, falsified=2",
  "gap_detected": true,
  "resolution": "completed",
  "prior_outcome_status": "partial",
  "notes": "resolution_policy=majority_held_is_success; held(7) > falsified(2) → completed"
}
```

`prior_outcome_status` is optional. When present, it must be one of the outcome
status values: `"held"`, `"falsified"`, `"undetermined"`, `"partial"`.

---

### `delegation` (unchanged from v0.4)

No changes. `delegation` records now accept `orf_version: "0.5"` in addition to
`"0.4"` and `"0.3"`.

---

## Migration from v0.4

**Reading v0.4 records in a v0.5 implementation:**

All v0.4 records are valid v0.5. No migration is required.

**Writing v0.5 records:**

Set `orf_version: "0.5"` in new records. Earlier records mixed into the same ledger
remain valid.

**Adopting `resolution_policy`:**

- Add `resolution_policy` to decisions where the domain has a defined policy for
  mixed outcomes.
- Omit it for decisions that do not aggregate sub-tasks (single-action decisions
  never produce `partial` outcomes; the field has no effect there).
- If adopting retroactively, the policy applies from when the field appears. Old
  decisions without it retain `"custom"` semantics.

**Updating reconcile logic:**

If your reconciler previously always wrote `"ambiguous"` when it found a `partial`
prior outcome, update it to inspect the original `decision.resolution_policy` and
apply the table above. The behavior for `"custom"` or absent policy is unchanged
(`"ambiguous"`), so the update is additive: add handling for the two encoded
policies, keep the `"ambiguous"` default.

---

## What ORF Still Does Not Solve

Items explicitly out of scope (updated from v0.4):

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
   welcome.
2. **`majority_held_is_success` threshold** — the spec uses `held > falsified` as
   the success threshold. Should the threshold be configurable (e.g., `"80%_held_is_success"`)?
   Or is a configurable threshold a signal that `"custom"` is the right answer?
3. **`resolution_policy` on `delegation`** — should the policy propagate to the
   sub-agent's ledger via the `delegation` record, or is it strictly the
   orchestrator's concern? If a sub-agent returns `partial`, the orchestrator's
   `resolution_policy` is what matters; the delegation record currently has no
   policy field.
4. **`partial` in `aggregate.partial` count (v0.4 open question #4)** — still open;
   needs real orchestrator implementations that produce nested `partial` outcomes.

---

## Versioning

This is `orf_version: "0.5"`. Backward-compatible additions (new optional fields,
new record types, enum extensions) increment the minor version. Breaking changes
(removing required fields, narrowing enum values) bump the major version.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
