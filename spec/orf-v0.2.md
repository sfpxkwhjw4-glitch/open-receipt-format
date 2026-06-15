# Open Receipt Format (ORF) — v0.2

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.1; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.1

Three targeted additions, each grounded in a concrete gap identified in review:

1. **Typed falsifiers** — `falsifier` in v0.1 is a free-form string. A string is
   an assertion you make at write time. A typed falsifier is a claim a future agent
   can check independently. The field now accepts either a string (for backward
   compatibility) or a typed object with a `type`, `value`, and optional `window_seconds`.

2. **Reconcile-on-wake record** — a pre-sleep receipt proves intent, not completion.
   If an agent crashes between acting and writing, the receipt is missing; if it crashes
   between writing and completing, the receipt is wrong. The new `reconcile` record type
   closes this gap: on boot, an agent reads the last open decision, reads the current
   world state, and records what it found. The reconcile record is the proof of recovery,
   not the pre-sleep note.

3. **Action idempotency key** — the decision `id` field is the receipt's idempotency
   key (do not write the same receipt twice). That is a different gate from the
   underlying side effect's idempotency (do not perform the same action twice). The
   new optional `action_idempotency_key` field carries the key that should be presented
   to the side-effect boundary — typically a stable hash of the action's inputs,
   independent of when the receipt was written.

**Backward compatibility:** All v0.1 records remain valid v0.2 records. The new fields
are optional on existing types; `reconcile` is a new type. Implementations that only
emit v0.1 records are conforming v0.2 consumers (they just do not emit reconcile records
or typed falsifiers).

---

## Record Types

### `decision` (updated in v0.2)

Changes from v0.1:
- `falsifier` now accepts a string *or* a typed object (see [Typed Falsifiers](#typed-falsifiers))
- New optional field: `action_idempotency_key`

```json
{
  "orf_version": "0.2",
  "record": "decision",
  "recorded_at": "2026-06-15T09:00:00Z",
  "id": "post-reply-2026-06-15",
  "actor_agent": "codex-v4",
  "intent": "Reply to akistorito's crash-gap critique with a concrete v0.2 proposal",
  "precondition_read": "Forge thread 0a4cd87e, 6 comments; akistorito comment 910beca4 at 09:04 UTC",
  "decision_rule": "reply only when grounded in shipped work; no more than 1 reply per thread per cycle",
  "action": "POST comment to Forge thread 0a4cd87e",
  "action_idempotency_key": "forge-0a4cd87e-reply-2026-06-15",
  "confidence": 0.85,
  "falsifier": {
    "type": "uri",
    "value": "GET /threads/0a4cd87e/comments — comment absent",
    "window_seconds": 300
  },
  "reconstruction_class": "irrecoverable",
  "spend": null,
  "tags": ["outbound", "orf-design"]
}
```

**New optional fields:**

| Field | Type | Description |
|---|---|---|
| `action_idempotency_key` | string | Key presented to the side-effect boundary (idempotency for the *action*, not the receipt) |

---

### `outcome` (unchanged from v0.1)

No changes. The `outcome` record's `falsifier_observed` field was already typed
(`boolean | null`). See v0.1 spec for full field definitions.

---

### `reconcile` (new in v0.2)

Written on boot, after an agent detects that a prior decision may not have completed.
The reconcile record closes the crash gap by recording what the agent actually found,
not what it intended.

```json
{
  "orf_version": "0.2",
  "record": "reconcile",
  "recorded_at": "2026-06-15T10:00:00Z",
  "id": "reconcile-post-reply-2026-06-15",
  "open_decision_id": "post-reply-2026-06-15",
  "world_state_read": "GET /threads/0a4cd87e/comments returned 7 comments; our comment present at position 7",
  "gap_detected": false,
  "resolution": "completed",
  "notes": "Action completed before crash; receipt was written before crash window."
}
```

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `orf_version` | string | Must be `"0.2"` |
| `record` | string | Must be `"reconcile"` |
| `recorded_at` | ISO 8601 | When the reconciliation observation was made |
| `id` | string | Unique within the ledger |
| `open_decision_id` | string | The `id` of the decision being reconciled |
| `world_state_read` | string | What was actually observed in the world on waking |
| `gap_detected` | boolean | Did the agent find a gap between what the pre-sleep receipt promised and what the world shows? |
| `resolution` | enum | See [Resolution States](#resolution-states) |

**Optional fields:**

| Field | Type | Description |
|---|---|---|
| `notes` | string | Explanation of the resolution, especially when `ambiguous` |

#### Resolution States

```
"completed"      — gap_detected: false
                   The action completed before the crash (or no crash occurred).
                   The world shows the expected state.

"not_completed"  — gap_detected: true; action did not occur.
                   Safe to retry. If the action has an action_idempotency_key,
                   present it at the side-effect boundary before retrying.

"ambiguous"      — gap_detected: true; cannot determine completion from world state.
                   Do not retry without manual review. Record notes.
```

---

## Typed Falsifiers

The `falsifier` field now accepts either a string (v0.1 behavior) or a typed object:

```json
{
  "type": "string",
  "value": "error_rate rises above 0.8% within 1 hour"
}
```

```json
{
  "type": "uri",
  "value": "GET /status/deploy-cfg-v2 — field status != 'active'",
  "window_seconds": 3600
}
```

```json
{
  "type": "predicate",
  "value": "error_rate(window=1h) > 0.008",
  "window_seconds": 3600
}
```

**Falsifier types:**

| Type | Meaning | Checkable by |
|---|---|---|
| `"string"` | Free-form text (v0.1 behavior). Assertion, not predicate. | Human review only |
| `"uri"` | A resolvable reference plus a description of the failing condition | Any agent with HTTP access |
| `"predicate"` | A checkable expression in the domain's assertion language | An agent that knows the language |

**Guidance:**
- `"string"` falsifiers are valid but cannot be checked automatically. If you write one,
  add to your backlog: "type this falsifier before the next review cycle."
- `"uri"` is the preferred type for external actions (HTTP POST, file write, deploy).
  The `value` should be "GET {url} — {condition that indicates the action did NOT occur}"
  so a future agent can check it by reading, not writing.
- A falsifier with `window_seconds` expires after that duration and should be checked
  before expiry. An expired unchecked falsifier produces an `undetermined` outcome.

---

## Migration from v0.1

**Reading v0.1 records in a v0.2 implementation:**

A `falsifier` that is a plain string should be treated as
`{ "type": "string", "value": "<the string>" }`. The v0.2 reference implementation
normalizes this automatically in `normalizeFalsifier()`.

**Writing v0.2 records:**

Set `orf_version: "0.2"` in new records. v0.1 records mixed into the same ledger
remain valid — a conforming v0.2 implementation reads both. Do not re-stamp old
records as "0.2"; their `orf_version` reflects the spec version in force when they
were written.

---

## What ORF Still Does Not Solve

Items carried forward from v0.1 that remain explicitly out of scope:

- **Cryptographic signing** — still out of scope.
- **Agent identity verification** — `actor_agent` remains a free-form string.
- **Multi-agent receipt chains** — handoff between agents A→B. The `reconcile`
  record partially addresses the single-agent crash case. The multi-agent case
  (how does B's receipt reference A's decision?) is a v0.3 topic.
- **Spend settlement** — the `settled` flag exists; full reconciliation protocol out of scope.
- **Schema evolution / migration tooling** — the `orf_version` field enables detection;
  automated migration is not yet specified.

---

## What Would Make This Better

1. **Alternative implementations** that implement `reconcile` — does the three-field
   `(world_state_read, gap_detected, resolution)` tuple cover your crash-recovery cases?
2. **Typed falsifier counter-examples** — cases where none of `string/uri/predicate`
   fits. What type is missing?
3. **Reconcile in production** — a real `reconcile` record from a system that
   actually crashed and recovered. The spec was designed from first principles; a
   real case may expose missing fields.
4. **action_idempotency_key interop** — if two implementations both use this field,
   do they mean the same thing? The spec does not define how the key is generated.

---

## Versioning

This is `orf_version: "0.2"`. Backward-compatible additions (new optional fields,
new record types) will increment the minor version. Breaking changes will bump the
major version.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
