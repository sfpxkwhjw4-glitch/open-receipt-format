# ORF `world_state_read` by Boundary Type

The `world_state_read` field on a `reconcile` record asks one question:
**what did you actually observe when you woke up?**

The answer depends entirely on what kind of side effect you're recovering from.
This document covers the five most common boundary types, with example values,
resolution rules, and gotchas.

---

## The contract

A good `world_state_read` has three properties:

1. **Observed, not assumed** — it records what was read, not what was expected.
   "file exists" is an assumption. "stat(path) returned size=1234, mtime=2026-06-20T10:00:00Z" is an observation.

2. **Checkable by a future agent** — someone reading the ledger six months later
   should be able to reproduce the check, not just trust the string.

3. **Sufficient for resolution** — the value of `world_state_read` plus
   `gap_detected` should fully explain why `resolution` is what it is.
   If you have to read the `notes` field to understand how `world_state_read`
   leads to `resolution`, the observation was incomplete.

---

## 1. File write

**What to read:** file existence, size, and a content fingerprint (hash or line count).
Do not read the full content unless it's small. Size + modification time is usually enough.

```json
{
  "world_state_read": "stat(/data/output.json): size=4821 bytes, mtime=2026-06-20T09:58:12Z; sha256_first_512=a1b2c3d4",
  "gap_detected": false,
  "resolution": "completed"
}
```

```json
{
  "world_state_read": "stat(/data/output.json): ENOENT (file does not exist)",
  "gap_detected": true,
  "resolution": "not_completed"
}
```

```json
{
  "world_state_read": "stat(/data/output.json): size=0 bytes, mtime=2026-06-20T09:58:12Z",
  "gap_detected": true,
  "resolution": "ambiguous",
  "notes": "File was created but is empty; crash may have occurred mid-write. Do not serve until content is verified."
}
```

**Resolution rules:**
- File absent → `not_completed`. Retry is safe.
- File present, size matches expected → `completed`.
- File present, size = 0 or content hash mismatch → `ambiguous`. Do not retry without inspecting.
- Filesystem unreachable → leave `gap_detected: false` only if you are certain it was not written. If uncertain, use `ambiguous`.

**Gotcha:** Partial writes look like success. Always check size or a content fingerprint, not just existence.

---

## 2. HTTP POST (external API call)

The safest approach is to make the POST idempotent at the boundary, then verify via GET.
Without a GET, you're working from server-side idempotency keys (if the server supports them).

**Pattern A — GET to verify (preferred):**

```json
{
  "world_state_read": "GET /orders/ORD-20260620-0042 → 200 OK; status=confirmed, amount_cents=4999",
  "gap_detected": false,
  "resolution": "completed"
}
```

```json
{
  "world_state_read": "GET /orders/ORD-20260620-0042 → 404 Not Found",
  "gap_detected": true,
  "resolution": "not_completed"
}
```

**Pattern B — idempotency key check (when GET is not available):**

```json
{
  "world_state_read": "GET /idempotency-keys/order-2026-06-20-0042 → 204 No Content (key present; server processed the request)",
  "gap_detected": false,
  "resolution": "completed"
}
```

```json
{
  "world_state_read": "GET /idempotency-keys/order-2026-06-20-0042 → 404 Not Found (key not present; server has no record of this request)",
  "gap_detected": true,
  "resolution": "not_completed"
}
```

**Pattern C — POST-only endpoint, no idempotency support:**

```json
{
  "world_state_read": "POST /webhooks/notify → no GET endpoint; idempotency not supported; side effect may or may not have fired",
  "gap_detected": true,
  "resolution": "ambiguous",
  "notes": "Endpoint does not expose a verification surface. Manual check required before retry."
}
```

**Resolution rules:**
- GET returns the resource you created → `completed`.
- GET returns 404 → `not_completed`. Retry with same `action_idempotency_key`.
- Server accepts idempotency key and returns 409/2xx with same key → `completed`.
- No verification surface → `ambiguous`. Do not retry without human review.

**Gotcha:** A `2xx` response to your original POST is NOT part of `world_state_read` (that was in the past). Only record what you can observe *now*, on boot.

---

## 3. Database write (INSERT / UPDATE / UPSERT)

Read the row directly. Include the column values that make the row identifiable, plus
a version or timestamp column if one exists.

**Row present:**

```json
{
  "world_state_read": "SELECT id, status, updated_at FROM jobs WHERE id='job-20260620-0099' → 1 row: {status='completed', updated_at='2026-06-20T09:58:04Z'}",
  "gap_detected": false,
  "resolution": "completed"
}
```

**Row absent:**

```json
{
  "world_state_read": "SELECT id FROM jobs WHERE id='job-20260620-0099' → 0 rows",
  "gap_detected": true,
  "resolution": "not_completed"
}
```

**Partial state (multi-step write that was interrupted):**

```json
{
  "world_state_read": "SELECT id, status FROM jobs WHERE id='job-20260620-0099' → 1 row: {status='pending'}; expected status='completed'",
  "gap_detected": true,
  "resolution": "ambiguous",
  "notes": "Row exists in 'pending' state. A second agent may have claimed it, or the write was interrupted mid-transaction. Do not re-run without checking downstream effects."
}
```

**Resolution rules:**
- Row present with expected column values → `completed`.
- Row absent → `not_completed`. Retry (INSERT is naturally idempotent if you check first; for UPSERT, use `action_idempotency_key`).
- Row present but in unexpected state → `ambiguous`.
- Database unreachable → do not resolve; wait for connectivity before writing a `reconcile` record.

**Gotcha:** If multiple rows might match (bulk insert), SELECT COUNT and compare to your expected batch size.
A partial count → `ambiguous`.

---

## 4. Message queue (enqueue)

This is the hardest boundary type because most queues are write-only from the sender's perspective.
Once a message is consumed, it disappears from the queue — so absence does not mean "not sent."

**Broker supports deduplication IDs (SQS, Pulsar, etc.):**

```json
{
  "world_state_read": "ReceiveMessage with DeduplicationId=notify-user-123 → message present (not yet consumed): {MessageId='msg-abc123', Body='{\"user\":\"u-123\"}'}",
  "gap_detected": false,
  "resolution": "completed"
}
```

**Message consumed before reboot (presence unknown):**

```json
{
  "world_state_read": "ReceiveMessage with DeduplicationId=notify-user-123 → empty (message absent; may have been consumed or never sent); no ack log available",
  "gap_detected": true,
  "resolution": "ambiguous",
  "notes": "Queue is empty. Absence is consistent with both 'delivered and consumed' and 'never enqueued'. Check downstream consumer logs before retry to avoid double-delivery."
}
```

**Broker returned durable error at enqueue time:**

```json
{
  "world_state_read": "Enqueue attempt at 09:58:01Z returned BROKER_UNAVAILABLE; no message in retry queue; broker now healthy",
  "gap_detected": true,
  "resolution": "not_completed"
}
```

**Resolution rules:**
- Message visible in queue → `completed`. (It was enqueued; consumer hasn't taken it yet.)
- Message absent AND broker returned a durable error at enqueue → `not_completed`. Retry with `action_idempotency_key`.
- Message absent AND no durable error recorded → `ambiguous`. Do not retry without checking consumer side.
- No peek API → `ambiguous` by default. Record the fact that no observation was possible.

**Gotcha:** "Queue is empty" is an observation worth recording even when it doesn't resolve the question.
Write it in `world_state_read`. An honest `ambiguous` with a good observation beats a false `completed`.

---

## 5. Process restart / config deploy

These side effects change in-memory or runtime state. Verification reads the running
process or a live endpoint.

**Version endpoint:**

```json
{
  "world_state_read": "GET /health → {status:'ok', version:'2.1.0', config_hash:'a3f8...'}; expected version='2.1.0'",
  "gap_detected": false,
  "resolution": "completed"
}
```

**Old version still running:**

```json
{
  "world_state_read": "GET /health → {status:'ok', version:'2.0.3', config_hash:'b9e1...'}; expected version='2.1.0'",
  "gap_detected": true,
  "resolution": "not_completed"
}
```

**Process down:**

```json
{
  "world_state_read": "GET /health → connection refused; process not responding",
  "gap_detected": true,
  "resolution": "ambiguous",
  "notes": "Cannot determine if the restart is in progress or if the deploy failed. Do not re-trigger until process is back up and version can be verified."
}
```

**Resolution rules:**
- Version / config hash matches the value the deploy was supposed to produce → `completed`.
- Old version still running → `not_completed`. Retry deploy.
- Process down → `ambiguous`. Wait, then re-check.

**Gotcha:** A version check confirms the config was loaded, not that the deploy script ran.
If the process was already at the target version before your deploy, `world_state_read` will
look like `completed` even if your action had no effect. This is correct — the desired state is
present — but record the version *before* the action in `precondition_read` so a reader can see
whether your action was necessary.

---

## Choosing between `not_completed` and `ambiguous`

The key question is: **can you distinguish "it didn't happen" from "it happened but left no trace"?**

| Observation | Resolution |
|---|---|
| The side effect's artifact is absent AND absence definitively means it never happened | `not_completed` |
| The side effect's artifact is present (or verifiably recorded) | `completed` |
| The side effect's artifact is absent but absence could mean "consumed / cleaned up" | `ambiguous` |
| No observation surface exists | `ambiguous` |

When in doubt, use `ambiguous` with a detailed `notes` explaining what observation was available
and why it was insufficient. An honest `ambiguous` protects against double-delivery and
data corruption. A false `not_completed` causes a retry on an action that already completed.

---

## Minimum viable `world_state_read`

If you're constrained and cannot do a full check:

```json
{
  "world_state_read": "No check performed — agent restarted before reconcile was possible; prior decision had no idempotency key",
  "gap_detected": true,
  "resolution": "ambiguous",
  "notes": "Cannot recover without manual review. Flag for human."
}
```

An honest "I couldn't check" is a valid reconcile record. It closes the ledger entry
and routes it to human review rather than leaving it as an orphaned open decision.

---

## Related

- [`spec/orf-v0.2.md`](../spec/orf-v0.2.md) — `reconcile` record type specification
- [`examples/file-agent.js`](../examples/file-agent.js) — file boundary in code
- [`examples/http-agent.js`](../examples/http-agent.js) — HTTP boundary in code
- [`examples/queue-agent.js`](../examples/queue-agent.js) — queue boundary + ambiguous resolution in code
