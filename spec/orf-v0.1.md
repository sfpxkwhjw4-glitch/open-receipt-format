# Open Receipt Format (ORF) — v0.1

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## Motivation

Agents building memory and continuity systems keep independently inventing the
same artifact: a receipt for a state-changing action. The receipt answers four
questions a future agent will need to ask:

1. **What was actually read before acting?** (not assumed — observed)
2. **What rule drove the decision?** (not reconstructed later — recorded at decision time)
3. **What would have proved this wrong?** (not the claim, but its falsifier)
4. **Can this be rebuilt, or is the original irreplaceable?** (reconstruction cost)

Without answers to these questions, a "success" record is an assertion, not
a receipt. A future agent reading "action taken, result: success" cannot
distinguish a solid decision from a lucky guess.

ORF names these fields, fixes their types, and stops at the point where any
additional structure becomes domain-specific. It defines the smallest
interoperable core — the part every agent needs, regardless of what else they
store alongside it.

---

## Scope

ORF covers two record types:

- `decision` — a state-changing action, recorded before or immediately after
  the action, together with everything needed to evaluate it later.
- `outcome` — an observation that resolves a pending decision: did the
  falsifier occur?

ORF does **not** define:

- Storage format (JSONL, YAML, SQL — use whatever fits your stack)
- Transport protocol
- Signing or cryptographic identity
- Spend accounting beyond a flag that spend occurred
- Agent identity beyond a free-form string

These are outside the minimal interoperable core.

---

## Record Types

### `decision`

Records a single state-changing action and everything needed to evaluate it.

```json
{
  "orf_version": "0.1",
  "record": "decision",
  "recorded_at": "2026-06-14T21:00:00Z",
  "id": "deploy-cfg-v2-2026-06-14",
  "actor_agent": "codex-v3",
  "intent": "Deploy updated config to reduce retry noise",
  "precondition_read": "error_rate=0.4%, config_version=1, last_deploy=2026-06-07",
  "decision_rule": "deploy when error_rate > 0.2% AND 7+ days since last deploy",
  "action": "Wrote config v2 to /etc/agent/config.yaml; restarted service",
  "confidence": 0.82,
  "falsifier": "error_rate rises above 0.8% within 1 hour of deploy",
  "reconstruction_class": "irrecoverable",
  "spend": null,
  "tags": ["config", "deploy"]
}
```

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `orf_version` | string | Must be `"0.1"` for this version |
| `record` | string | Must be `"decision"` |
| `recorded_at` | ISO 8601 | When the receipt was written |
| `id` | string | Unique within the ledger; also the idempotency key |
| `actor_agent` | string | Identity of the agent taking the action |
| `intent` | string | Why: the goal this action serves |
| `precondition_read` | string | The state actually observed before acting — not assumed, observed |
| `decision_rule` | string | The rule or policy in force when the decision was made |
| `action` | string | What was done — specific enough to replay or audit |
| `confidence` | float [0..1] | Agent's stated confidence the action achieves the intent |
| `falsifier` | string | The one observation that would prove this wrong |
| `reconstruction_class` | enum | See [Reconstruction Classes](#reconstruction-classes) |

**Optional fields:**

| Field | Type | Description |
|---|---|---|
| `spend` | object \| null | Present if any spend occurred; see [Spend](#spend-optional) |
| `tags` | string[] | Domain-specific labels for filtering |

---

### `outcome`

Records an observation that resolves a pending decision. The `decision_id`
links it back to the original receipt.

```json
{
  "orf_version": "0.1",
  "record": "outcome",
  "recorded_at": "2026-06-14T22:05:00Z",
  "decision_id": "deploy-cfg-v2-2026-06-14",
  "observed_result": "error_rate dropped to 0.1% within 20 minutes; service stable",
  "falsifier_observed": false,
  "status": "held",
  "artifacts": ["logs/deploy/2026-06-14-config-v2.log"]
}
```

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `orf_version` | string | Must be `"0.1"` |
| `record` | string | Must be `"outcome"` |
| `recorded_at` | ISO 8601 | When the observation was made |
| `decision_id` | string | The `id` of the resolved decision |
| `observed_result` | string | What was actually observed |
| `falsifier_observed` | boolean \| null | Did the falsifying condition occur? `null` = not yet checkable |
| `status` | enum | Derived from `falsifier_observed`: see [Outcome Status](#outcome-status) |

**Optional fields:**

| Field | Type | Description |
|---|---|---|
| `artifacts` | string[] | Paths or references to supporting evidence |

---

## Field Semantics

### Reconstruction Classes

```
"recomputable"   — Can be rebuilt from still-available inputs.
                   Evictable under memory pressure; re-derive if needed.

"irrecoverable"  — The original is irreplaceable.
                   Must be pinned or backed up; cannot be rebuilt.
```

The distinction matters for memory management and disaster recovery. A
`recomputable` action that failed can be retried. An `irrecoverable` action
that failed may require manual intervention.

### Outcome Status

```
"held"           — falsifier_observed: false
                   The falsifying condition provably did not occur.
                   The decision's claim holds.

"falsified"      — falsifier_observed: true
                   The falsifying condition occurred.
                   The decision's claim is refuted.

"undetermined"   — falsifier_observed: null
                   Not yet checkable. Re-examine later.
```

An `undetermined` outcome is not a failure — some falsifiers take time to
check. A ledger with many long-pending `undetermined` outcomes is a signal
to schedule a review pass.

### `precondition_read`

This field records what the agent *actually read* from the environment — not
what it assumed or computed. The distinction matters when replaying decisions:
if the recorded precondition differs from current state, the same decision rule
may produce a different action. "I assumed the config was version 1" is not a
precondition. "I read config_version=1 from /etc/agent/config.yaml at 21:00 UTC"
is a precondition.

### `decision_rule`

The policy, heuristic, or instruction that drove the decision — recorded
*at decision time*, not reconstructed after the fact. If the rule changes
between cycles, decisions made under the old rule remain attributable to it.
This is how drift becomes auditable: compare the rule in force at time T to
the rule in force now.

### `falsifier`

The one observation that would prove the decision wrong. A falsifier:

- Must be specific enough to check (not "if something goes wrong")
- Must name the observable (metric, file, response, count, state)
- Should include a threshold or time window when applicable

A decision without a falsifier is not a claim — it is an assertion. The falsifier
makes success checkable by a future agent who was not present when the decision
was made.

### `confidence`

A float from 0 to 1 representing the agent's stated confidence at decision time
that the action achieves its stated intent. This field enables calibration: a
system that tracks confidence against resolved outcomes can detect whether the
agent is systematically over- or under-confident, by task type or over time.

### Spend (optional)

Present when the action involves expenditure. Minimum fields:

```json
{
  "spend": {
    "idempotency_key": "deploy-cfg-v2-2026-06-14-spend",
    "payee": "cloud-provider",
    "max_amount_usd": 0.50,
    "funding_authority": "budget-2026-q2",
    "settled": false
  }
}
```

The `idempotency_key` ensures a retry of a failed spend cannot double-charge.
Write the intent receipt (with `settled: false`) before acting; update to
`settled: true` when confirmed.

---

## Append-Only Ledger

ORF records are append-only by design. Never mutate a `decision` record after
writing it — that would change what was true at decision time.

To correct a decision: write a new `decision` with a new `id`, then write an
`outcome` for the old decision with `observed_result` describing the correction
and why.

The idempotency guarantee: if a `decision` with a given `id` already exists in
the ledger, an implementation should return the existing record without writing
a new one. This makes receipts safe to emit in retry loops.

---

## Minimal Implementation

The simplest conforming implementation is append-only JSONL:

```js
const fs = require("fs");

function record(ledgerPath, entry) {
  // Idempotency: do not write the same id twice
  const existing = fs.existsSync(ledgerPath)
    ? fs.readFileSync(ledgerPath, "utf8")
        .split("\n").filter(Boolean)
        .map(l => JSON.parse(l))
        .find(r => r.record === "decision" && r.id === entry.id)
    : null;
  if (existing) return existing;

  const r = { orf_version: "0.1", recorded_at: new Date().toISOString(), ...entry };
  fs.appendFileSync(ledgerPath, JSON.stringify(r) + "\n");
  return r;
}
```

The reference implementation ([`reference/recorder.js`](../reference/recorder.js))
adds validation, idempotency lookup, the falsifier differential, a replay plan,
and an append-only ledger on top of this core — all zero-dependency, covered by
tests (`node --test`). None of that is required for ORF conformance.

---

## What ORF Does Not Solve

To keep the spec minimal and adoptable, the following are explicitly out of scope
for v0.1:

- **Cryptographic signing** — nothing prevents adding a `signature` field; ORF
  does not require or define it.
- **Agent identity verification** — `actor_agent` is a free-form string; binding
  it to a cryptographic identity is left to implementations.
- **Schema evolution** — the `orf_version` field is present to allow future
  versions; migration between versions is not yet defined.
- **Multi-agent receipt chains** — when agent A hands off to agent B, how their
  receipts reference each other is not specified. This is a natural v0.2 topic.
- **Spend settlement** — the `spend.settled` flag exists; a full spend-reconciliation
  protocol is out of scope.
- **Crash-gap / reconcile-on-wake** — a receipt written *before* an action proves
  intent but not completion; a receipt written *after* can be lost if the agent
  crashes between acting and writing. Closing this gap (reconcile against the
  world on wake, not the pre-sleep note) is an open v0.2 question raised in review.

---

## What Would Make This Better

This is a draft. Things it needs:

1. **Alternative implementations** to verify the spec is implementable without
   reference to this design's choices.
2. **Counter-examples**: cases where the field definitions are ambiguous or wrong.
3. **The multi-agent handoff case**: how does an outcome written by agent B get
   linked back to a decision written by agent A?
4. **Typed falsifiers**: should `falsifier` be a free-form string, or a typed,
   resolvable predicate (a URI or checkable expression)? Raised in review; open.
5. **Real-world falsifiers**: examples from non-trivial production decisions where
   the falsifier was actually checked and found to hold or not.

If you have implemented something similar, the most useful thing you can share is
one real `decision` record from your own system, even if the fields don't match.
The gaps between your record and this spec are where the real standard lives.

---

## Versioning

This is `orf_version: "0.1"`. The version field exists so implementations can
migrate gracefully as the spec evolves. Breaking changes will increment the minor
version; backward-compatible additions will not.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
