# Cross-Ledger Receipt References

When an orchestrator agent references a sub-agent's receipt in its own `artifacts`
field, two implementations will immediately invent different string formats:

```
"artifacts": ["ledger://receipts/monitor-run-20260628"]   // implementation A
"artifacts": ["/var/log/monitor/receipts.jsonl#monitor-run-20260628"]  // implementation B
"artifacts": ["monitor-run-20260628"]                      // implementation C (hope for the best)
```

None of these is wrong, but they are not interoperable. This document proposes
a stable URI scheme for ORF artifact references, and conventions for mapping those
URIs to physical storage.

---

## The `orf://` URI scheme

An ORF artifact reference has the form:

```
orf://{ledger-name}/{decision-id}
```

Examples:

```
orf://monitor-agent-socials/harvest-monitor-2026-06-28T15-53
orf://founder-cycle/cycle-2026-06-28T15-53
orf://payment-processor/charge-ref-abc123
```

**`ledger-name`** is a stable, short identifier for the agent or system that owns the
ledger. It should be:
- Lowercase, hyphen-separated (consistent with DNS conventions)
- Stable across restarts and deployments — name the *role*, not the instance
- Unique within your system (a namespace, not a UUID)

**`decision-id`** is the `id` field from the target decision or reconcile record,
exactly as it appears in the ledger. No encoding; if the id contains slashes or
spaces, encode them as `%2F` / `%20` per standard URI escaping.

---

## Why a URI, not a structural field

An alternative design would use a structured object:

```json
{
  "artifacts": [
    { "ledger": "monitor-agent-socials", "decision_id": "harvest-monitor-2026-06-28T15-53" }
  ]
}
```

This is explicit and unambiguous. It is the right choice if your system has a fixed
ledger registry and resolves references programmatically.

The URI form is preferred when:
- You want artifacts to appear in logs, grep output, or prose documentation
- You are passing the reference through a system that only handles strings
- You want a human to be able to read and follow the reference without parsing JSON

Both forms are valid. The key constraint is: **pick one form within a system and use
it consistently.** Mixing URI strings and structured objects in the same `artifacts`
array creates ambiguity.

---

## Ledger identity

A ledger is not a file path. It is a logical identity. The same ledger may be
stored in different locations across environments:

| Environment | Physical location |
|---|---|
| Development | `./receipts/monitor-agent-socials.jsonl` |
| Production | `s3://receipts-bucket/monitor-agent-socials/` |
| Testing | In-memory or temp file |

The URI `orf://monitor-agent-socials/harvest-monitor-2026-06-28T15-53` is stable
across all three. The mapping from `monitor-agent-socials` to a physical path is
configuration, not part of the receipt.

**Recommendation:** maintain a ledger registry — a simple map from ledger name to
storage location — in your system's configuration. This can be as simple as a
JSON file or environment variables:

```json
{
  "monitor-agent-socials": "./receipts/monitor-agent-socials.jsonl",
  "founder-cycle":         "./receipts/founder-cycle.jsonl"
}
```

ORF does not define the registry format or the resolution protocol. It only
defines the URI scheme for referring to a decision within a named ledger.

---

## How to dereference an `orf://` reference

Given `orf://monitor-agent-socials/harvest-monitor-2026-06-28T15-53`:

1. Look up `monitor-agent-socials` in your ledger registry to get the physical path.
2. Open the ledger (typically a JSONL file or an API endpoint).
3. Find the record with `"id": "harvest-monitor-2026-06-28T15-53"` and
   `"record": "decision"` (or `"reconcile"`).
4. If the record is not found, the reference is dangling — the sub-agent may not have
   written the receipt yet, or the ledger may be in a different location.

**Dangling references are not errors.** Receipts are written asynchronously. An
orchestrator may write an artifact reference before the sub-agent's own ledger is
flushed. Consumers should handle the not-found case by retrying within a reasonable
window before treating it as an error.

---

## Using `orf://` in practice

**Pattern 3 from orchestrator-patterns.md — orchestrator outcome referencing a sub-agent receipt:**

```json
{
  "orf_version": "0.2",
  "record": "outcome",
  "recorded_at": "2026-06-28T15:53:15Z",
  "decision_id": "harvest-monitor-2026-06-28T15-53",
  "observed_result": "monitor returned reply_count=16, all 200s",
  "falsifier_observed": false,
  "status": "held",
  "artifacts": [
    "orf://monitor-agent-socials/monitor-run-2026-06-28T15-53"
  ]
}
```

**Pattern 2 — orchestrator's cycle decision referencing parallel sub-tool decisions:**

```json
{
  "orf_version": "0.2",
  "record": "decision",
  "id": "cycle-2026-06-28T15-53",
  "actor_agent": "founder-cycle",
  "intent": "Run harvest cycle — monitor + thread-replies",
  "action": "parallel invoke: monitor-agent-socials.js, check-thread-replies.js",
  "artifacts": [
    "orf://founder-cycle/harvest-monitor-2026-06-28T15-53",
    "orf://founder-cycle/harvest-replies-2026-06-28T15-53"
  ]
}
```

When sub-tools are the same agent's own decisions, the `ledger-name` is the
same as the orchestrator. When they are separate agents with their own ledgers,
the `ledger-name` differs.

---

## What this does not solve

This proposal defines a naming convention, not a protocol. It does not specify:

- How to resolve a ledger name to a physical storage location (that is system configuration)
- How to handle authorization when ledgers are in different systems or tenants
- How to merge ledgers for archiving or audit export
- How to ensure that an artifact reference written before the sub-agent's receipt
  is available remains valid after retention policies delete old records

These are infrastructure questions. The `orf://` scheme stays at the naming layer
so that receipts are portable across storage backends.

---

## Relationship to v0.3

Standardizing the `orf://` URI scheme is proposed as a v0.3 addition. It would:

- Add `orf://` as a recognized artifact reference format in the spec
- Define the `ledger-name` / `decision-id` grammar
- Require that any implementation claiming "cross-ledger artifact support" uses
  this scheme rather than bare strings or absolute paths

The `artifacts` field today is `string[]`. A conforming v0.3 implementation would
accept any string in `artifacts` (backward compatibility) but parse and resolve
`orf://`-prefixed entries using the registered ledger registry.
