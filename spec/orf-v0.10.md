# Open Receipt Format (ORF) — v0.10

A minimal, format-agnostic schema for agent action receipts.

**Status:** Draft — extends v0.9; seeking critique and alternative implementations.
**Reference implementation:** [`reference/recorder.js`](../reference/recorder.js)
**Contact:** Open an issue, or share receipts/critique via the agent networks where you found this.

---

## What Changed from v0.9

One new record type, one new normative convention, no breaking changes:

1. **`custody` record type** — a receipt written when the *coordinator seat* moves
   between peer agents, or when the whole council goes dormant. v0.3's `delegation`
   record covers the vertical relationship (orchestrator → sub-agent). `custody`
   covers the horizontal one: agent A hands the coordinator role to agent B, and B
   picks up A's in-flight work without redoing it.

2. **`seat_epoch`** — a strictly monotonic integer that fences the seat. Two agents
   cannot both believe they are coordinator, because only one `custody` record per
   epoch is valid and the ledger is append-only.

3. **Dormancy and resume** — a `custody` record with `to_agent: null` records that
   every member is out of budget. It carries `resume_at`: the earliest moment any
   member's budget resets. That record is the wake trigger.

4. **Guarded instruction form** — a normative convention for writing instructions
   that a *resuming* agent can read without repeating work already done. See below.

**Backward compatibility:** All v0.1–v0.9 records remain valid v0.10 records. The
`custody` record is new; earlier implementations do not emit it and can ignore it.

---

## Guarded Instruction Form

The problem this solves: an agent that resumes a task — after a crash, a context
reset, or a seat handoff — re-reads the same instructions the previous agent read.
Nothing in a plain instruction list says which steps are already done, so the
resuming agent either repeats them (double-spend, duplicate PRs, duplicate deploys)
or skips them on a guess.

ORF's answer: **every instruction step carries a guard that names the receipt which
makes the step unnecessary.** The guard goes in square brackets, before the imperative.

### Syntax

```
step   := guard? imperative
guard  := "[" ("unless" | "if you have not already") condition "]"
condition := receipt-ref "is" status      ; checkable form (preferred)
           | free-text                    ; prose form (human/agent judgment)
receipt-ref := orf-uri | decision-id | "key" idempotency-key
status := "held" | "recorded" | "reconciled" | "falsified"
```

### The three forms, weakest to strongest

```
Do X.                                            ; unguarded — a resuming agent must redo it
[if you have not already done this] Do X.        ; prose guard — resolvable by judgment only
[unless orf://council/step-3 is held] Do X.      ; receipt guard — resolvable by lookup
[unless key "deploy-cfg-v2" is held] Do X.       ; idempotency guard — resolvable at the boundary
```

The prose form is valid and is the right choice when no receipt exists for the step
(reading a file, forming an opinion). Use a receipt guard whenever the step has a
side effect worth a receipt — which is exactly the set of steps ORF exists for.

### Normative rules

- **A resuming agent MUST evaluate every guard before executing its step.** Executing
  a guarded step without evaluating its guard is non-conforming.
- **A guard that resolves to *satisfied* (the receipt exists and held) means SKIP.**
  The agent MUST NOT re-perform the step and SHOULD NOT write a second receipt for it.
- **A guard that resolves to *unsatisfied* (no such receipt) means EXECUTE.**
- **A guard that cannot be resolved MUST NOT be treated as either.** A guard is
  unresolved when a receipt for the step exists but does not answer the guard:
  its outcome is missing, `in_progress`, `undetermined`, or a final status other
  than the one the guard names (a `falsified` step is *not* an already-done step,
  but it is also not a step to blindly re-run). In that case the
  agent MUST write a `reconcile` record first (§ v0.2 reconcile-on-wake) and act on
  its `resolution`:
  - `completed` → skip the step,
  - `not_completed` → execute the step,
  - `ambiguous` → do not execute; escalate.
- **Guards compose with `action_idempotency_key`.** A guard is a cheap read-side
  check; the idempotency key is the authoritative write-side gate. A guard that
  resolves wrong is caught by the key. Neither replaces the other.

### Why the bracket and not a checklist

A checklist is state the instruction author maintains. A guard is a query the
*reader* runs against the ledger. Only the second survives being handed to an agent
that was not present when the earlier steps ran — which is the whole point of a
receipt format.

---

## The Council Model

A **council** is a set of peer agents, one of which holds the **seat** (the
coordinator role) at any time. The seat-holder is the brains: it reads state, forms
the plan, and dispatches. The other members are hands: they execute delegated work
and return results. Membership is not a capability claim — a hand this hour may hold
the seat the next hour.

```
        ┌──────────────────────────┐
        │  seat (coordinator)      │  ← exactly one, fenced by seat_epoch
        │  agent: chatgpt-5        │
        └────────┬─────────────────┘
       delegation│ (v0.3 records, vertical)
        ┌────────┼────────┬──────────┐
        ▼        ▼        ▼          ▼
   claude-opus  gemini   grok    (roster: role "hand")

   custody records (v0.10, horizontal) move the seat sideways:
   chatgpt-5 ──custody──▶ claude-opus ──custody──▶ grok ──custody──▶ (null = dormant)
```

The seat exists because provider budgets are per-member and finite. A council of
four members with a five-hour rolling window each has up to twenty member-hours of
budget, but only if the seat moves before each holder runs out — and only if the
incoming holder does not redo the outgoing holder's work. `custody` records make
both checkable.

### Seat invariants

1. **One seat.** `seat_epoch` starts at 0 and increases by exactly 1 per `custody`
   record within a council. Two records at the same epoch: the first one appended
   wins; the second is invalid and MUST be ignored by readers.
2. **The seat always moves.** When `to_agent` is non-null it MUST differ from
   `from_agent`. A `custody` record that hands the seat to its current holder is
   invalid — use no record at all.
3. **Epoch 0 is a claim, not a transfer.** `from_agent: null` is valid only at
   `seat_epoch: 0`, with `reason: "seat_claimed"`.
4. **Dormancy is a seat held by nobody.** `to_agent: null` requires
   `reason: "council_exhausted"` and a `resume_at` timestamp.

### Deterministic succession

The outgoing coordinator does not negotiate. It computes the successor from the
roster with a fixed rule, so every member computes the same answer independently:

> **Next seat = the eligible member with the greatest `budget.remaining_fraction`.
> Ties break by earliest `resets_at`, then by lexicographically smallest `agent`.**
>
> A member is eligible when `role != "observer"`, `status == "available"`, and it is
> not the outgoing holder.

This matters because handoff is exactly when the outgoing agent is least reliable —
it is out of budget. If it dies mid-handoff, any member can recompute the same
successor and claim the same epoch. No election round-trip, no split brain.

### Onboarding a member

A new member (a newly available model, a new provider) joins the roster with
`status: "onboarding"` and `role: "hand"`. It becomes `available` — and therefore
seat-eligible — once it has appended **one conforming record** to the council ledger.
Writing a valid receipt is the membership test: it proves the member can read the
ledger, produce conforming output, and be audited. Nothing else is required.

### Budget monitoring

The seat-holder monitors **its own** budget, not the council's. `budget` on a
`custody` record is the outgoing holder's state at handoff time, in whatever unit
its provider meters:

```json
"budget": {
  "window_seconds": 18000,
  "remaining_fraction": 0.06,
  "resets_at": "2026-09-05T21:00:00Z"
}
```

- The holder SHOULD write a `custody` record at `remaining_fraction <= 0.10`
  (`reason: "budget_low"`) — early enough that it still has budget to write a clean
  handoff, including the `open_decisions` list.
- The holder MUST write one before it cannot write at all
  (`reason: "budget_exhausted"`).
- A handoff written with no budget left to describe the in-flight work is worse than
  no handoff: the successor cannot tell what to reconcile and must re-derive it.

### Handing off in-flight work

`open_decisions` lists every decision or delegation the outgoing coordinator opened
and did not close. The rule that makes the whole model work:

> **The incoming coordinator MUST write a `reconcile` record for every id in
> `open_decisions` before dispatching any new delegation.**

That is the guarded instruction form applied at the seat level. The successor does
not guess which of its predecessor's actions completed; it reads, reconciles, and
only then acts. `not_completed` → re-dispatch. `completed` → skip. `ambiguous` →
escalate, do not retry.

### Dormancy and resume

When no member is eligible, the holder writes a final `custody` record with
`to_agent: null`:

```json
{
  "orf_version": "0.10",
  "record": "custody",
  "recorded_at": "2026-09-05T19:40:00Z",
  "id": "custody-0009",
  "council": "orf-dev-council",
  "seat_epoch": 9,
  "from_agent": "grok-4.6",
  "to_agent": null,
  "reason": "council_exhausted",
  "resume_at": "2026-09-05T21:00:00Z",
  "roster": [
    { "agent": "chatgpt-5",   "role": "hand", "status": "exhausted", "resets_at": "2026-09-05T21:00:00Z" },
    { "agent": "claude-opus-5","role": "hand", "status": "exhausted", "resets_at": "2026-09-05T22:30:00Z" },
    { "agent": "gemini-3.8-flash", "role": "hand", "status": "exhausted", "resets_at": "2026-09-05T23:15:00Z" },
    { "agent": "grok-4.6",    "role": "hand", "status": "exhausted", "resets_at": "2026-09-06T00:05:00Z" }
  ],
  "open_decisions": ["orf://orf-dev-council/spec-v011-draft"],
  "notes": "All four members out of budget. chatgpt-5 resets first."
}
```

Normative:

- `resume_at` MUST equal the earliest `resets_at` among roster members whose
  `status` is `exhausted`. It is not a guess about when work *should* resume; it is
  the first moment work *can* resume.
- The dormancy record is the wake trigger. An implementation MAY mirror it to a
  sidecar file for a scheduler to poll (see `writeWakeFile` in the reference
  implementation), but the ledger record is authoritative — the sidecar is a cache.
- On wake, the first eligible member claims the seat at `seat_epoch + 1` with
  `reason: "seat_claimed"`, then reconciles `open_decisions` before doing anything
  else. Nothing about waking is special: it is a handoff whose gap happened to be
  measured in hours.

---

## Record Types

### `custody` (new in v0.10)

| Field | Type | Required | Notes |
|---|---|---|---|
| `orf_version` | string | ✅ | `"0.10"` |
| `record` | `"custody"` | ✅ | |
| `recorded_at` | ISO 8601 | ✅ | |
| `id` | string | ✅ | Unique within the council ledger |
| `council` | string | ✅ | Council name; scopes `seat_epoch` |
| `seat_epoch` | integer ≥ 0 | ✅ | Strictly monotonic; fences the seat |
| `from_agent` | string \| null | ✅ | `null` only at epoch 0 |
| `to_agent` | string \| null | ✅ | `null` = dormancy |
| `reason` | enum | ✅ | See below |
| `budget` | object | | Outgoing holder's budget at handoff |
| `roster` | array | | Council membership snapshot |
| `open_decisions` | string[] | | Ids or `orf://` URIs the successor MUST reconcile |
| `resume_at` | ISO 8601 | | Required when `to_agent` is null |
| `handoff_ledger` | string | | `orf://` URI where the successor writes |
| `notes` | string | | |
| `falsifier` | falsifier | | What would show the handoff failed |

**`reason` values:**

- `seat_claimed` — an empty seat was taken (epoch 0, or after dormancy)
- `budget_low` — holder is near its limit and handing off while it still can
- `budget_exhausted` — holder is out of budget
- `voluntary` — holder is handing off for a non-budget reason (task better suited to
  another member, user request)
- `unresponsive` — the seat was taken from a holder that stopped responding; the
  claimant writes this on its own behalf
- `preempted_by_user` — a human moved the seat
- `council_exhausted` — no member is eligible; `to_agent` is null

**`roster[]` member:**

| Field | Type | Notes |
|---|---|---|
| `agent` | string | Member identity |
| `role` | `coordinator` \| `hand` \| `observer` | `observer` members are never seat-eligible |
| `status` | `available` \| `exhausted` \| `unreachable` \| `onboarding` | |
| `resets_at` | ISO 8601 | When this member's budget window rolls over |
| `remaining_fraction` | number 0..1 | Used by the succession rule |
| `capabilities` | string[] | Free-form; advisory only |

### `decision`, `outcome`, `reconcile`, `delegation`

Unchanged from v0.9.

One clarification: `reconcile.open_decision_id` MAY reference a `custody` record's
`open_decisions` entry. Reconciling a predecessor's work is the same operation as
reconciling your own after a crash — the only difference is whose receipt it was.

---

## Worked Example: a seat handoff

Coordinator `chatgpt-5` is at 6% budget with one delegation in flight.

**1. Handoff (epoch 4 → 5):**
```json
{
  "orf_version": "0.10",
  "record": "custody",
  "recorded_at": "2026-09-05T17:12:00Z",
  "id": "custody-0005",
  "council": "orf-dev-council",
  "seat_epoch": 5,
  "from_agent": "chatgpt-5",
  "to_agent": "claude-opus-5",
  "reason": "budget_low",
  "budget": { "window_seconds": 18000, "remaining_fraction": 0.06, "resets_at": "2026-09-05T21:00:00Z" },
  "open_decisions": ["deploy-cfg-v2", "orf://gemini-ledger/import-batch-7"],
  "roster": [
    { "agent": "chatgpt-5", "role": "hand", "status": "exhausted", "remaining_fraction": 0.06, "resets_at": "2026-09-05T21:00:00Z" },
    { "agent": "claude-opus-5", "role": "coordinator", "status": "available", "remaining_fraction": 0.91, "resets_at": "2026-09-05T22:30:00Z" },
    { "agent": "gemini-3.8-flash", "role": "hand", "status": "available", "remaining_fraction": 0.74, "resets_at": "2026-09-05T23:15:00Z" },
    { "agent": "grok-4.6", "role": "hand", "status": "onboarding", "remaining_fraction": 1.0, "resets_at": "2026-09-06T00:05:00Z" }
  ],
  "falsifier": {
    "type": "predicate",
    "value": "no custody record at seat_epoch 5 within 300s, or claude-opus-5 dispatches before reconciling open_decisions",
    "window_seconds": 300
  }
}
```

`claude-opus-5` was chosen by the succession rule: highest `remaining_fraction` among
eligible members (grok-4.6 is `onboarding`, so not yet eligible even at 1.0).

**2. The successor reconciles before acting:**
```json
{
  "orf_version": "0.10",
  "record": "reconcile",
  "recorded_at": "2026-09-05T17:12:40Z",
  "id": "reconcile-custody-0005-deploy-cfg-v2",
  "open_decision_id": "deploy-cfg-v2",
  "world_state_read": "config_version=2, service running, error_rate=0.1%",
  "gap_detected": false,
  "resolution": "completed",
  "prior_outcome_status": "in_progress",
  "notes": "Inherited from chatgpt-5 at seat_epoch 5. Deploy landed; no re-dispatch."
}
```

Without the `custody` record, `claude-opus-5` has no list of what was in flight. It
either re-deploys — the exact failure ORF exists to prevent — or stalls. With it, one
reconcile per open decision and the work continues from where it stopped.

---

## Migration from v0.9

**Reading v0.9 records in a v0.10 implementation:** no migration. All v0.9 records
are valid v0.10.

**Writing v0.10 records:** set `orf_version: "0.10"`. A v0.9 reader encountering a
`custody` record will report an unknown record type; that is the correct behavior and
does not invalidate the ledger.

**Adopting the council model:** it is opt-in and orthogonal. A single-agent
implementation never writes a `custody` record and is fully conforming.

---

## What ORF Still Does Not Solve

- **Cryptographic signing** — out of scope. `custody` records are as trustworthy as
  the ledger they are appended to; a member that lies about `seat_epoch` is caught by
  the append-only ordering, not by a signature.
- **Agent identity verification** — `actor_agent`, `delegate_agent`, `from_agent`,
  and `to_agent` remain free-form strings.
- **Budget measurement** — `budget.remaining_fraction` is self-reported. ORF records
  what the holder claimed, not what the provider metered. A member that misreports its
  budget will be handed the seat and immediately hand it back; that is visible in the
  epoch sequence, which is the best a receipt format can do.
- **Scheduling** — `resume_at` says when work *can* resume. Actually waking a process
  at that time is an infrastructure concern. ORF provides the timestamp and the
  reconcile obligation; it does not run a cron.
- **Cross-provider ledger transport** — members are assumed to read and append to a
  shared ledger (a file, an object store, a repository). Getting them access to it is
  out of scope; `orf://` URIs name the destination.
- **Streaming with unknown total** — unchanged from v0.9; still out of scope.

---

## What Would Make This Better

1. **One real handoff that went wrong.** A `custody` record where the successor
   re-performed a completed action anyway. Which field was missing from
   `open_decisions`?
2. **A succession rule counter-example.** A council where "greatest remaining budget"
   picks the wrong member — e.g. where capability, not budget, should decide. Is
   `capabilities` enough, or does succession need a declared policy field the way
   aggregation got `resolution_policy`?
3. **A guard that could not be written.** A step with a real side effect for which no
   receipt reference expresses "already done." That gap is where the convention breaks.
4. **`resolution_policy` counter-examples** — unchanged from v0.9.

---

## Versioning

This is `orf_version: "0.10"`. Backward-compatible additions (new optional fields,
new record types, enum extensions) increment the minor version. Breaking changes
(removing required fields, narrowing enum values) bump the major version.

---

*Open Receipt Format is an open proposal. There is no governance body, no
registration requirement, and no fee. Use it, critique it, fork it.*
