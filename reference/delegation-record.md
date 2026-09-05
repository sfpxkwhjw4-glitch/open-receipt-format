# ORF Delegation Records

A `delegation` record is the structured handoff receipt for orchestrators that invoke
sub-agents. It captures the *intent* of the delegation (what the orchestrator asked)
separately from the sub-agent's *execution* (what the sub-agent actually ran and recorded).

---

## Why a delegation record?

A `decision` record's `action` field captures "what I did." For direct actions — POST a
comment, write a file — that is precise enough. For sub-agent invocations, `action`
conflates two things:

1. **Delegated intent** — what the orchestrator asked the sub-agent to do
2. **Actual execution** — what the sub-agent ran, which the orchestrator cannot know
   until B returns (and may never know if B crashes)

Using `action: "invoke monitor-agent.js"` in a `decision` record is correct but informal.
It does not name the sub-agent as a structured field, does not carry the delegated
instructions explicitly, and does not link to the sub-agent's own receipt chain.

The `delegation` record type fills this gap.

---

## Record structure

```json
{
  "orf_version": "0.2",
  "record": "delegation",
  "recorded_at": "2026-06-28T20:53:00Z",
  "id": "delegate-harvest-monitor-2026-06-28T20-53",
  "delegating_agent": "founder-cycle",
  "delegate_agent": "monitor-agent-socials",
  "delegated_intent": "Harvest agentgram reply counts for the 11 target posts; return total reply count and per-post HTTP statuses",
  "delegate_ledger": "orf://monitor-agent-socials/receipts",
  "parent_decision_id": "cycle-2026-06-28T20-53",
  "action_idempotency_key": "monitor-socials-harvest-2026-06-28T20-53"
}
```

---

## Fields

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `orf_version` | string | Must be `"0.2"` |
| `record` | string | Must be `"delegation"` |
| `recorded_at` | ISO 8601 | When the orchestrator wrote this record (before invoking B) |
| `id` | string | Unique within the orchestrator's ledger |
| `delegating_agent` | string | The orchestrator writing this record (same as `actor_agent` on its decision records) |
| `delegate_agent` | string | The sub-agent being invoked (should match `actor_agent` on B's own receipts) |
| `delegated_intent` | string | What the orchestrator instructed B to do — the assignment, not just the tool name |

**Optional fields:**

| Field | Type | Description |
|---|---|---|
| `delegate_ledger` | string | `orf://` URI for B's receipt ledger; where to find B's receipts after invocation |
| `parent_decision_id` | string | The orchestrator's own cycle/decision record that triggered this delegation |
| `action_idempotency_key` | string | Key for the invocation boundary — same semantics as in `decision` records |
| `falsifier` | string or typed object | Condition that would indicate B failed to execute the delegated task |

---

## Outcome after delegation

When the sub-agent returns, the orchestrator writes an `outcome` record pointing to
the delegation ID — not to its own cycle decision. This keeps the outcome scoped to
the specific handoff, not the overall cycle.

```json
{
  "orf_version": "0.2",
  "record": "outcome",
  "recorded_at": "2026-06-28T20:53:15Z",
  "decision_id": "delegate-harvest-monitor-2026-06-28T20-53",
  "observed_result": "monitor-agent exited 0; reply_count=16; all HTTP 200",
  "falsifier_observed": false,
  "status": "held",
  "artifacts": [
    "orf://monitor-agent-socials/monitor-run-2026-06-28T20-53"
  ]
}
```

The `artifacts` field uses the `orf://` URI scheme from
[`reference/cross-ledger.md`](cross-ledger.md) to reference the sub-agent's own receipt.
The orchestrator does not need to know what B recorded internally — it only needs to
know where B's ledger is (from `delegate_ledger`) and what decision ID B used.

---

## Crash recovery via delegation records

If the orchestrator crashes after writing the `delegation` but before receiving B's
result, the `reconcile` record on boot reads the sub-agent's ledger directly.

**On recovery, if B completed:**

```json
{
  "orf_version": "0.2",
  "record": "reconcile",
  "recorded_at": "2026-06-28T21:10:00Z",
  "id": "reconcile-delegate-harvest-monitor-2026-06-28T20-53",
  "open_decision_id": "delegate-harvest-monitor-2026-06-28T20-53",
  "world_state_read": "GET orf://monitor-agent-socials/receipts — found decision monitor-run-2026-06-28T20-53 with outcome status=held, recorded_at=2026-06-28T20:53:14Z",
  "gap_detected": false,
  "resolution": "completed",
  "notes": "Sub-agent receipt present and held; B completed before orchestrator crashed."
}
```

**On recovery, if B never ran:**

```json
{
  "open_decision_id": "delegate-harvest-monitor-2026-06-28T20-53",
  "world_state_read": "GET orf://monitor-agent-socials/receipts — no record with id matching the expected delegation window",
  "gap_detected": true,
  "resolution": "not_completed",
  "notes": "B's ledger has no receipt matching this invocation. Safe to re-invoke."
}
```

The `delegate_ledger` field on the delegation record is what makes recovery navigable:
the recovering orchestrator knows exactly where to look without needing to scan the
filesystem or guess a path.

**Resolution rules for delegation recovery:**

```
"completed"      — B's ledger has a receipt written after the delegation's recorded_at.
                   Do not re-invoke.

"not_completed"  — B's ledger has no receipt, or B's own reconcile record shows
                   not_completed. Safe to re-invoke (present action_idempotency_key
                   if available).

"ambiguous"      — B's ledger has a receipt but its outcome is "undetermined" or
                   B's reconcile shows "ambiguous". Do not re-invoke without
                   manual review.
```

---

## Relationship to Pattern 2 (parallel invocations)

In [Pattern 2 from orchestrator-patterns.md](orchestrator-patterns.md), the orchestrator
writes multiple `decision` records for parallel sub-tools, then a parent `decision`
linking them via `artifacts`. With delegation records, the same pattern becomes explicit:

- Each parallel sub-invocation gets a `delegation` record
- Each `delegation` carries `parent_decision_id` pointing to the cycle decision
- The cycle decision's `artifacts` carries the delegation IDs (same ledger)

```json
{
  "orf_version": "0.2",
  "record": "decision",
  "id": "cycle-2026-06-28T20-53",
  "actor_agent": "founder-cycle",
  "intent": "Run harvest cycle — monitor + thread-replies",
  "action": "parallel delegation to monitor-agent-socials and check-thread-replies",
  "artifacts": [
    "orf://founder-cycle/delegate-harvest-monitor-2026-06-28T20-53",
    "orf://founder-cycle/delegate-harvest-replies-2026-06-28T20-53"
  ]
}
```

This disambiguates two different artifact relationships:
- `artifacts` in a delegation `outcome` → references the *sub-agent's* receipt (cross-ledger)
- `artifacts` in the cycle decision → references the *delegation records* (same ledger)

---

## Delegation chains

When A delegates to B and B delegates to C, each hop writes its own delegation record
in its own ledger. The chain is traversable by following `orf://` references:

```
A's ledger:  delegation → delegate_ledger: orf://B-ledger/...
B's ledger:  delegation → delegate_ledger: orf://C-ledger/...
```

ORF does not define a chain-traversal protocol. A reader follows the chain
by dereferencing each `delegate_ledger` URI in sequence. This is intentional:
long chains are an infrastructure concern, not a receipt format concern.

---

## What this does not solve

**Sub-agent identity verification.** `delegate_agent` is a free-form string, same as
`actor_agent` elsewhere. Cryptographic proof that the right agent ran is out of scope.

**Bidirectional linking.** B's receipts do not reference the orchestrator's delegation ID.
The link is one-directional: the orchestrator knows about B's ledger; B does not need to
know who invoked it. This is intentional — sub-agents should be self-contained.

**Delegation chain traversal.** A delegates to B, B delegates to C. Each hop writes its
own delegation record; ORF does not currently define how to traverse or aggregate the chain
automatically. See also Gap #3 (aggregated outcomes).

---

## Relationship to v0.3 gaps

This document addresses Gap #2 from
[`reference/orchestrator-patterns.md`](orchestrator-patterns.md). The three gaps are now:

1. Cross-ledger references — *(addressed in [`reference/cross-ledger.md`](cross-ledger.md))*
2. Delegation record type — *(this document)*
3. Aggregated outcomes schema — *(still open)*

The `delegation` record is proposed as a new record type in v0.3, alongside the `orf://`
URI scheme formalized in cross-ledger.md. Together they close the two structural gaps in
orchestrator receipt chains.

---

## Open questions

1. **Should `delegate_ledger` be a required field?** Making it required would force
   implementations to define a ledger identity up front, which strengthens crash recovery.
   Making it optional preserves flexibility for simple cases (same-process sub-agents that
   do not write receipts).

2. **Should `delegated_intent` be structured or free text?** The current proposal uses a
   free string (consistent with `intent` in `decision` records). A structured form
   (`{ "task": "...", "constraints": [...] }`) would be more queryable but is harder to
   write for ad-hoc invocations.

3. **What if the orchestrator does not know B's decision ID in advance?** The `artifacts`
   field on the outcome must reference B's receipt, but B picks its own ID. The orchestrator
   must read B's ledger after the fact to find the matching record. One convention: require
   that B's decision ID incorporate the invocation's `action_idempotency_key`, making it
   predictable. This is a convention, not a spec rule.

---

## The other axis: `custody` (v0.10)

`delegation` records the *vertical* relationship — an orchestrator invoking a sub-agent
while keeping authority. It does not describe what happens when authority itself moves:
one peer handing the coordinator role to another because its budget ran out.

That is the `custody` record, added in v0.10. The two are complements, not alternatives —
a coordinator writes `delegation` records all cycle long and one `custody` record when it
leaves. See [`council-protocol.md`](council-protocol.md) and
[`spec/orf-v0.10.md`](../spec/orf-v0.10.md).
