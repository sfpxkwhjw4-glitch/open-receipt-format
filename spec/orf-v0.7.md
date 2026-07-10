# Open Receipt Format (ORF) — v0.7

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.6; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.6

One normative closure, no new schema fields:

1. **`decision.resolution_policy` is the *declared* policy; `aggregate.resolution_policy` is the *applied* policy** — closes v0.6 open question #2. These two fields serve distinct roles: `decision.resolution_policy` records what policy the orchestrator intended to apply (written at decision time, before sub-agents run); `aggregate.resolution_policy` records what was actually applied when computing `outcome.status` (written at outcome time, after results are in). They SHOULD match absent deliberate overrides, but ORF does not and SHOULD NOT require them to match.

   **Why not enforce consistency?**
   - Enforcement requires consumers to cross-reference two record types at read time, coupling the aggregate reader to the originating decision.
   - Legitimate runtime overrides exist: an orchestrator instructed to relax or tighten a policy for a specific run should record what it applied — not be forced to re-issue a new decision.
   - The separation is consistent with ORF's broader pattern: decisions record *intent*; outcomes record *reality*.

   **Normative guidance:** When `aggregate.resolution_policy` diverges from `decision.resolution_policy`, record the reason in `outcome.notes`. This makes the override auditable without requiring cross-record lookups.

**Backward compatibility:** All v0.6 (and earlier) records remain valid v0.7 records. The only schema change is `orf_version` enum extended to include `"0.7"`.

---

## Record Types

### `decision` (unchanged from v0.6)

No changes. `decision.resolution_policy` is now explicitly defined as the **declared policy** — what the orchestrator intends to apply when aggregating sub-task outcomes.

---

### `outcome` (normative clarification in v0.7)

No schema changes. Normative addition: when `aggregate.resolution_policy` diverges from the originating `decision.resolution_policy`, document the reason in `outcome.notes`.

#### Declared vs. Applied Policy — Example

Decision declares `any_falsified_is_failure`; runtime override applies `majority_held_is_success`:

```json
{
  "orf_version": "0.7",
  "record": "outcome",
  "recorded_at": "2026-07-10T02:30:00Z",
  "decision_id": "import-batch-2026-07-10",
  "observed_result": "batch complete: 9 records imported, 0 failed",
  "falsifier_observed": false,
  "status": "held",
  "notes": "Decision declared any_falsified_is_failure; majority_held_is_success applied per operator instruction at 02:28Z.",
  "aggregate": {
    "total": 9,
    "held": 9,
    "falsified": 0,
    "undetermined": 0,
    "resolution_policy": "majority_held_is_success"
  }
}
```

The aggregate is authoritative: it records what was actually applied. The divergence is visible without looking up the originating decision, because the reason is in `outcome.notes`.

#### Consistent Policy — Example (no divergence)

When no override occurs, `aggregate.resolution_policy` matches `decision.resolution_policy`:

```json
{
  "orf_version": "0.7",
  "record": "outcome",
  "recorded_at": "2026-07-10T03:00:00Z",
  "decision_id": "import-batch-2026-07-10-b",
  "observed_result": "batch complete: 7 held, 2 falsified",
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
      { "decision_id": "import-record-2", "status": "falsified" },
      { "decision_id": "import-record-3", "status": "held" },
      { "decision_id": "import-record-4", "status": "held" },
      { "decision_id": "import-record-5", "status": "falsified" },
      { "decision_id": "import-record-6", "status": "held" },
      { "decision_id": "import-record-7", "status": "held" },
      { "decision_id": "import-record-8", "status": "held" },
      { "decision_id": "import-record-9", "status": "held" }
    ]
  }
}
```

---

### `reconcile` (unchanged from v0.6)

No changes. `reconcile` records accept `orf_version: "0.7"` in addition to earlier versions.

---

### `delegation` (unchanged from v0.6)

No changes. `delegation` records accept `orf_version: "0.7"` in addition to earlier versions.

---

## Migration from v0.6

**Reading v0.6 records in a v0.7 implementation:**

All v0.6 records are valid v0.7. No migration required.

**Writing v0.7 records:**

Set `orf_version: "0.7"` in new records. Earlier records mixed into the same ledger remain valid.

**Adopting the declared/applied distinction:**

- If your aggregator always applies the policy declared in the originating decision: `aggregate.resolution_policy` and `decision.resolution_policy` will match. No notes needed.
- If your aggregator ever applies a different policy: add the reason to `outcome.notes`. This is a SHOULD, not a MUST — but it makes the override auditable.

---

## What ORF Still Does Not Solve

Items explicitly out of scope (updated from v0.6):

- **Cryptographic signing** — still out of scope.
- **Agent identity verification** — `actor_agent` and `delegate_agent` remain free-form strings.
- **Multi-agent receipt chains** — chain traversal protocol remains an infrastructure concern; `delegation` records and `orf://` URIs provide the primitives.
- **Spend settlement** — the `settled` flag exists; full reconciliation protocol out of scope.
- **Schema evolution / migration tooling** — the `orf_version` field enables detection; automated migration is not yet specified.
- **Streaming / async aggregation** — `aggregate` models a cycle with N known sub-tasks at outcome-write time. Systems that stream results asynchronously need a different pattern; not yet specified.

---

## What Would Make This Better

1. **`resolution_policy` in practice** — does the three-value enum cover real domain policies, or do real orchestrators need a fourth value? Counter-examples welcome. (Unchanged from v0.6.)
2. **`partial` in `aggregate.partial` count (v0.4 open question #4)** — still open; needs real orchestrator implementations that produce nested `partial` outcomes. (Renumbered from v0.6 open question #3.)

---

## Versioning

This is `orf_version: "0.7"`. Backward-compatible additions (new optional fields,
new record types, enum extensions) increment the minor version. Breaking changes
(removing required fields, narrowing enum values) bump the major version.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
