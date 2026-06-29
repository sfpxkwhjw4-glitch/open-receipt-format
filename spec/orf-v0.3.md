# Open Receipt Format (ORF) — v0.3

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.2; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.2

Three targeted additions, each grounded in concrete gaps surfaced when running
orchestrator agents that delegate to sub-agents:

1. **`orf://` URI scheme** — standardizes cross-ledger artifact references. An
   `orf://{ledger-name}/{decision-id}` URI is a stable pointer to a specific decision
   in a named ledger, independent of physical storage location. The `artifacts` field
   on any record now has a recognized format for cross-ledger pointers; bare strings
   remain valid for backward compatibility.

2. **`delegation` record type** — captures the structured handoff when an orchestrator
   invokes a sub-agent. Records the delegated intent, the sub-agent's identity, and
   where to find the sub-agent's own receipt chain (`delegate_ledger`). Separates
   "what the orchestrator asked for" from "what the sub-agent actually ran." Also
   enables crash recovery: if the orchestrator crashes before the sub-agent returns,
   the `delegate_ledger` URI tells the recovering orchestrator exactly where to look.

3. **`aggregate` field on `outcome`** — optional structured breakdown for multi-tool
   and multi-agent cycles. Records per-sub-task statuses and counts (total / held /
   falsified / undetermined) as machine-readable data, removing the need to parse
   natural language from `observed_result`. The top-level `status` remains the
   orchestrator's judgment; `aggregate` exposes the components.

**Backward compatibility:** All v0.2 records remain valid v0.3 records. The new fields
are optional on existing types; `delegation` is a new record type. Implementations
that only emit v0.2 records are conforming v0.3 consumers.

---

## Record Types

### `decision` (unchanged from v0.2)

No schema changes. The `artifacts` field now has a recognized format for entries
that begin with `orf://` — see [Cross-Ledger URI Scheme](#cross-ledger-uri-scheme).

```json
{
  "orf_version": "0.3",
  "record": "decision",
  "recorded_at": "2026-06-29T11:53:00Z",
  "id": "cycle-2026-06-29T11-53",
  "actor_agent": "founder-cycle",
  "intent": "Run harvest cycle — monitor, thread-replies, inbound",
  "precondition_read": "No open decisions in ledger; prior cycle outcome=held",
  "decision_rule": "cycle is held if no primary sensor falsified; undetermined inbound tolerated",
  "action": "parallel invoke: monitor-agent-socials.js, check-thread-replies.js, inbound.js",
  "confidence": 1.0,
  "falsifier": "any primary tool exits non-zero",
  "reconstruction_class": "recoverable",
  "artifacts": [
    "orf://founder-cycle/delegate-monitor-2026-06-29T11-53",
    "orf://founder-cycle/delegate-replies-2026-06-29T11-53"
  ]
}
```

---

### `outcome` (updated in v0.3)

Changes from v0.2:
- New optional field: `aggregate` (see [Aggregated Outcomes](#aggregated-outcomes))

```json
{
  "orf_version": "0.3",
  "record": "outcome",
  "recorded_at": "2026-06-29T11:53:30Z",
  "decision_id": "cycle-2026-06-29T11-53",
  "observed_result": "harvest complete: monitor held (reply_count=16), replies held (total=111), inbound undetermined (network timeout)",
  "falsifier_observed": false,
  "status": "held",
  "aggregate": {
    "total": 3,
    "held": 2,
    "falsified": 0,
    "undetermined": 1,
    "sub_outcomes": [
      { "decision_id": "harvest-monitor-2026-06-29T11-53", "status": "held" },
      { "decision_id": "harvest-replies-2026-06-29T11-53", "status": "held" },
      {
        "decision_id": "inbound-check-2026-06-29T11-53",
        "status": "undetermined",
        "notes": "GET https://api.github.com/repos/... timed out; not retried this cycle"
      }
    ]
  }
}
```

**New optional fields:**

| Field | Type | Description |
|---|---|---|
| `aggregate` | object | Structured breakdown of sub-task outcomes (see below) |

---

### `reconcile` (unchanged from v0.2)

No changes. `reconcile` is written on boot after detecting an open decision; see
v0.2 spec for full field definitions. A `reconcile` record with `open_decision_id`
pointing to a `delegation` record uses the `delegate_ledger` URI to check whether
the sub-agent completed before the crash — the recovery procedure is the same
regardless of whether the open decision was a `decision` or `delegation` record.

```json
{
  "orf_version": "0.3",
  "record": "reconcile",
  "recorded_at": "2026-06-29T12:10:00Z",
  "id": "reconcile-delegate-monitor-2026-06-29T11-53",
  "open_decision_id": "delegate-monitor-2026-06-29T11-53",
  "world_state_read": "GET orf://monitor-agent-socials/receipts — decision monitor-run-2026-06-29T11-53 present; outcome status=held",
  "gap_detected": false,
  "resolution": "completed"
}
```

---

### `delegation` (new in v0.3)

Written by an orchestrator before invoking a sub-agent. Records the delegated
intent, the sub-agent's identity, and where to find the sub-agent's receipt chain.

```json
{
  "orf_version": "0.3",
  "record": "delegation",
  "recorded_at": "2026-06-29T11:53:01Z",
  "id": "delegate-monitor-2026-06-29T11-53",
  "delegating_agent": "founder-cycle",
  "delegate_agent": "monitor-agent-socials",
  "delegated_intent": "Harvest agentgram reply counts for the 11 target posts; return total reply count and per-post HTTP statuses",
  "delegate_ledger": "orf://monitor-agent-socials/receipts",
  "parent_decision_id": "cycle-2026-06-29T11-53",
  "action_idempotency_key": "monitor-socials-harvest-2026-06-29T11-53"
}
```

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `orf_version` | string | Must be `"0.3"` |
| `record` | string | Must be `"delegation"` |
| `recorded_at` | ISO 8601 | When the orchestrator wrote this record (before invoking the sub-agent) |
| `id` | string | Unique within the orchestrator's ledger |
| `delegating_agent` | string | The orchestrator writing this record |
| `delegate_agent` | string | The sub-agent being invoked |
| `delegated_intent` | string | What the orchestrator instructed the sub-agent to do — the assignment, not just the tool name |

**Optional fields:**

| Field | Type | Description |
|---|---|---|
| `delegate_ledger` | string | `orf://` URI for the sub-agent's receipt ledger; where to find its receipts after invocation |
| `parent_decision_id` | string | The orchestrator's own cycle or decision record that triggered this delegation |
| `action_idempotency_key` | string | Key for the invocation boundary — same semantics as in `decision` records |
| `falsifier` | string or typed object | Condition that would indicate the sub-agent failed to execute the delegated task |

#### Outcome after delegation

When the sub-agent returns, the orchestrator writes an `outcome` pointing to the
delegation's `id` — not to the cycle decision. This keeps the outcome scoped to
the specific handoff.

```json
{
  "orf_version": "0.3",
  "record": "outcome",
  "recorded_at": "2026-06-29T11:53:15Z",
  "decision_id": "delegate-monitor-2026-06-29T11-53",
  "observed_result": "monitor-agent exited 0; reply_count=16; all HTTP 200",
  "falsifier_observed": false,
  "status": "held",
  "artifacts": [
    "orf://monitor-agent-socials/monitor-run-2026-06-29T11-53"
  ]
}
```

#### Crash recovery via delegation records

If the orchestrator crashes after writing the `delegation` but before receiving the
sub-agent's result, the recovery procedure is:

1. On boot, find the open `delegation` record (no corresponding `outcome`).
2. Look up `delegate_ledger` to get the sub-agent's ledger URI.
3. Dereference the URI (see [Cross-Ledger URI Scheme](#cross-ledger-uri-scheme)).
4. Check whether the sub-agent wrote a receipt for this invocation.

```
Resolution rules for delegation recovery:

"completed"     — sub-agent's ledger has a receipt written after delegation's recorded_at.
                  Do not re-invoke.

"not_completed" — sub-agent's ledger has no receipt matching this invocation.
                  Safe to re-invoke (present action_idempotency_key if available).

"ambiguous"     — sub-agent's ledger has a receipt but its outcome is "undetermined",
                  or the sub-agent's own reconcile record shows "ambiguous".
                  Do not re-invoke without manual review.
```

#### Delegation chains

When A delegates to B and B delegates to C, each hop writes its own `delegation`
record in its own ledger. The chain is traversable by following `delegate_ledger`
URIs in sequence. ORF does not define a chain-traversal protocol; readers follow
the chain by dereferencing each URI. Long chains are an infrastructure concern.

---

## Cross-Ledger URI Scheme

The `orf://` URI scheme provides a stable, storage-independent way to reference a
specific decision within a named ledger. Any field that accepts a string reference
to an artifact or a ledger may use this scheme.

### Syntax

```
orf://{ledger-name}/{decision-id}
```

**`ledger-name`** — a stable short identifier for the agent or system that owns
the ledger:
- Lowercase, hyphen-separated (consistent with DNS conventions)
- Names the *role*, not the instance — stable across restarts and deployments
- Unique within your system

**`decision-id`** — the `id` field from the target decision, delegation, or
reconcile record, exactly as it appears in the ledger. Standard URI encoding
applies: `%2F` for `/`, `%20` for space.

**Special form for ledger roots:** `orf://{ledger-name}/receipts` refers to the
ledger as a whole (used in `delegate_ledger`). This is a convention, not a
lookup for a specific record.

### Examples

```
orf://monitor-agent-socials/harvest-monitor-2026-06-29T11-53
orf://founder-cycle/cycle-2026-06-29T11-53
orf://payment-processor/charge-ref-abc123
```

### Dereferencing

Given `orf://monitor-agent-socials/harvest-monitor-2026-06-29T11-53`:

1. Look up `monitor-agent-socials` in your system's ledger registry to get the
   physical path (a config file, environment variable, or service endpoint).
2. Open the ledger (typically a JSONL file or API).
3. Find the record with `"id": "harvest-monitor-2026-06-29T11-53"`.
4. If not found, the reference is dangling — the sub-agent may not have written
   the receipt yet. Retry within a reasonable window before treating as an error.

**Dangling references are not errors.** Receipts are written asynchronously.

### Ledger registry

ORF does not define the registry format or the resolution protocol. A minimal
registry is a JSON map from ledger name to physical path:

```json
{
  "monitor-agent-socials": "./receipts/monitor-agent-socials.jsonl",
  "founder-cycle":         "./receipts/founder-cycle.jsonl"
}
```

The `orf://` scheme stays at the naming layer so that receipts are portable
across storage backends.

---

## Aggregated Outcomes

The `aggregate` field on an `outcome` record records the structured breakdown of
sub-task results for orchestrators that run multiple tools or sub-agents in a
single cycle.

### Field structure

**`aggregate` (optional object):**

| Field | Type | Description |
|---|---|---|
| `total` | integer ≥ 1 | Total number of sub-tasks in this cycle |
| `held` | integer ≥ 0 | Count of sub-tasks with status `held` |
| `falsified` | integer ≥ 0 | Count of sub-tasks with status `falsified` |
| `undetermined` | integer ≥ 0 | Count of sub-tasks with status `undetermined` |
| `sub_outcomes` | array | Per-sub-task detail (see below) |

Invariant: `held + falsified + undetermined == total`. Records that violate this
are malformed.

**Each `sub_outcomes` entry:**

| Field | Type | Description |
|---|---|---|
| `decision_id` | string | Decision ID of this sub-task in the orchestrator's ledger, or an `orf://` URI for cross-ledger sub-tasks |
| `status` | string | One of `held`, `falsified`, `undetermined` |
| `notes` | string | Optional. Explanation for non-`held` status |

`decision_id` may reference a `decision`, `delegation`, or `reconcile` record.
If the sub-task crashed and was recovered, the reconcile record's ID is the
appropriate reference.

### Setting the top-level `status`

The top-level `status` on the `outcome` record reflects the **orchestrator's
overall judgment**, not a mechanical formula derived from the aggregate counts.
ORF does not impose a resolution policy because partial success means different
things in different systems:

- A monitoring cycle with 2 of 3 sensors held and 1 undetermined may call this
  `held` (the primary read succeeded; an optional channel being unavailable is
  acceptable).
- A payment batch with 4 of 5 sub-agents held and 1 falsified may call this
  `falsified` (any financial failure is a failure).

The `aggregate` field exposes the components. The `decision_rule` field on the
cycle `decision` record is where the orchestrator should document its resolution
policy. Consistent application of that policy is the conformance requirement;
ORF does not audit the policy itself.

---

## Migration from v0.2

**Reading v0.2 records in a v0.3 implementation:**

All v0.2 records are valid v0.3. No migration is required. A v0.3 reader that
encounters a record with `orf_version: "0.2"` should treat it identically to a
`"0.3"` record — the schema is additive.

**Writing v0.3 records:**

Set `orf_version: "0.3"` in new records. v0.2 (and v0.1) records mixed into the
same ledger remain valid. Do not re-stamp old records; their `orf_version` reflects
the spec version in force when they were written.

**Adopting the new features:**

- **`orf://` URIs:** Adopt incrementally by adding the prefix to new artifact
  references. Bare strings in existing `artifacts` fields remain valid.
- **`delegation` records:** Start writing them when your orchestrator invokes
  sub-agents. Existing `decision` records that describe sub-agent invocations in
  their `action` field are not wrong — `delegation` is additive, not a replacement.
- **`aggregate` field:** Add to `outcome` records for multi-tool cycles. Existing
  outcomes with natural-language `observed_result` are still conforming v0.3.

---

## What ORF Still Does Not Solve

Items explicitly out of scope (updated from v0.2):

- **Cryptographic signing** — still out of scope.
- **Agent identity verification** — `actor_agent` and `delegate_agent` remain
  free-form strings. The `delegation` record names the sub-agent but does not
  prove which process ran.
- **Multi-agent receipt chains** — *(addressed in v0.3 via `delegation` records
  and `orf://` URIs)*. Chain traversal protocol and deep aggregation across
  multiple hops remain infrastructure concerns.
- **Spend settlement** — the `settled` flag exists; full reconciliation protocol
  out of scope.
- **Schema evolution / migration tooling** — the `orf_version` field enables
  detection; automated migration is not yet specified.
- **`partial` outcome status** — an orchestrator with some sub-tasks `held` and
  some `falsified` must choose one of the existing statuses and explain in
  `observed_result`. A first-class `partial` status is a v0.4 candidate; adding
  it now would break v0.2 consumers that do not know the new enum value.
- **Streaming / async aggregation** — `aggregate` models a cycle with N known
  sub-tasks at outcome-write time. Systems that stream results asynchronously
  need a different pattern; not yet specified.

---

## What Would Make This Better

1. **Alternative implementations of `delegation`** — does the
   `(delegating_agent, delegate_agent, delegated_intent, delegate_ledger)` tuple
   cover your orchestration cases? What fields are missing?
2. **Crash recovery in production with `delegation` records** — a real case where
   a recovering orchestrator used `delegate_ledger` to determine whether to
   re-invoke. The recovery procedure was designed from first principles.
3. **Ledger registry conventions** — ORF defines the URI scheme but not how to
   maintain the registry. If you implement a registry, share the format.
4. **`aggregate` with streaming sub-tasks** — if your orchestrator invokes
   sub-tasks over time (not all at once), how do you handle the final count?
   The current model assumes all sub-tasks are known at outcome-write time.
5. **`partial` status feedback** — is the current guidance (pick `held` or
   `falsified` and explain in `observed_result`) workable? Counter-examples
   are useful for deciding whether a first-class `partial` status is worth the
   enum break.

---

## Versioning

This is `orf_version: "0.3"`. Backward-compatible additions (new optional fields,
new record types) will increment the minor version. Breaking changes (removing
required fields, narrowing enum values) will bump the major version. A `partial`
outcome status, if added, would be a minor increment — existing enum consumers
that reject unknown values would need updating, but existing records remain valid.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
