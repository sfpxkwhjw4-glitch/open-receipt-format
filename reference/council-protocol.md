# Council protocol — moving the coordinator seat without redoing work

Companion to [`spec/orf-v0.10.md`](../spec/orf-v0.10.md). The spec defines the `custody`
record and its invariants; this document covers the parts that are practice rather than
schema: why the seat exists, what goes wrong, and how a new member joins.

The operating prompt itself — the guarded step list a member actually follows — is
[`COUNCIL.md`](../COUNCIL.md).

---

## The arithmetic that motivates this

Four agents, each metered on its own five-hour rolling window, are worth up to twenty
member-hours of continuous work. That is only true under two conditions:

1. **The seat moves before each holder runs out.** A holder that works until it cannot
   write loses the ability to describe what it was doing.
2. **The successor does not redo the predecessor's work.** Two members each spending an
   hour on the same task turn twenty member-hours into ten.

`custody` records buy the first. `open_decisions` plus the reconcile obligation buys the
second. Neither is worth much alone: a handoff with no inheritance list just relocates the
problem, and an inheritance list with no seat fence lets two agents work it at once.

---

## Two directions of delegation

ORF now has records for both axes, and they answer different questions:

| | `delegation` (v0.3) | `custody` (v0.10) |
|---|---|---|
| Direction | vertical: orchestrator → sub-agent | horizontal: peer → peer |
| Answers | "who did I ask, and what for?" | "who is in charge now, and what did they inherit?" |
| Authority | the delegator keeps it | the seat moves; the sender gives it up |
| Written | before invoking | before the holder runs out of budget |
| Recovery hook | `delegate_ledger` | `open_decisions` |

A council uses both. The seat-holder writes `delegation` records all cycle long, then one
`custody` record when it leaves.

---

## Failure modes, and what catches each

**Two coordinators.** Both members conclude they should hold the seat and both dispatch.
Caught by `seat_epoch`: only one record per epoch is valid, and on a conflict the first
appended wins. The loser sees this on its next read of the ledger — `currentSeat()` does
not return it — and steps down to hand. It does not need to be told; the ledger says so.

**A stranded seat.** The holder dies during handoff, after deciding but before appending.
No `custody` record exists, so the seat still reads as the dead holder's. Caught by
deterministic succession: any member recomputes `nextSeat()` from the same roster, gets the
same answer, and the intended successor claims the epoch itself with
`reason: "unresponsive"`. This is why succession is a formula and not a negotiation — the
one moment you need it is the moment the outgoing member is least able to participate.

**A silent redo.** The successor re-deploys something the predecessor already deployed.
Caught by the reconcile obligation *before* the fact and by `action_idempotency_key` at the
boundary *after* it. Guards are a cheap read-side check; the idempotency key is the
authoritative write-side gate. A guard that resolves wrong is caught by the key. Neither
replaces the other.

**A too-late handoff.** The holder writes `custody` at `remaining_fraction: 0.005` with an
empty `open_decisions` because it had no budget left to enumerate them. Nothing catches
this — which is why the threshold is 10%, not 1%. The successor inherits a clean-looking
handoff and quietly starts over. If you find yourself choosing between finishing one more
dispatch and writing a complete handoff, write the handoff.

**A lying budget.** A member reports `remaining_fraction: 0.9` and is out after one
dispatch. Nothing catches it directly — the number is self-reported and ORF records what
the holder claimed, not what the provider metered. It shows up as a short epoch: seat in,
seat straight back out. A council that sees a member's epochs consistently lasting one
dispatch has its answer in the ledger, which is the best a receipt format can do.

**A member that never resets.** Its `resets_at` passes and it is still unreachable. Mark it
`unreachable` rather than `available`; `unreachable` members are not seat-eligible, so
succession routes around it without a special case.

---

## Onboarding a member

Adding a provider to the council is deliberately close to nothing:

1. Add it to the roster with `role: "hand"`, `status: "onboarding"`, and its
   `resets_at` / `remaining_fraction` if known. `onboarding` members receive delegated work
   but are not seat-eligible.
2. Delegate something small and give it the ledger location.
3. When it appends one conforming record — validated by
   [`conformance/validate.js`](../conformance/validate.js) — flip its status to
   `available` in the next `custody` record's roster. It is now seat-eligible.

That single record is the entire membership test. It proves the member can read the ledger,
produce conforming output, and be audited by the others. There is no capability
declaration, no handshake, and no vote, because none of those are checkable and a receipt
is.

The `capabilities` field on a roster member exists and is advisory only. It does not feed
the succession rule. A council that wants capability-weighted succession needs a declared
policy field — the way aggregation got `resolution_policy` — and that does not exist yet.
If you need it, that is the counter-example the spec is asking for.

---

## Dormancy is not a special case

When `nextSeat()` returns null, the holder writes `to_agent: null` and `resume_at`. On
wake, the first eligible member claims `seat_epoch + 1` and reconciles `open_decisions`
before anything else — the same two steps as any other seat change. The only difference is
that the gap was measured in hours instead of seconds.

This is deliberate. A wake path that ran different logic from a handoff path would be
tested a fraction as often and would be the first thing to rot. The wake sidecar written by
`writeWakeFile()` exists so a scheduler can poll a timestamp without parsing JSONL; it
carries no logic of its own and the ledger record remains authoritative.

---

## What this does not give you

- **A scheduler.** `resume_at` is a timestamp. Something outside ORF has to wake at it.
- **Transport.** Members are assumed to be able to read and append to a shared ledger. Cron,
  object store, repository, queue — ORF names the destination with `orf://` URIs and stops.
- **Trust.** A member that appends a false `custody` record is not prevented from doing so.
  It is made visible: the epoch sequence is append-only and every claim in it is attributed.

That last one is the deliberate line ORF has drawn since v0.1. A receipt is not a promise
that the writer was honest. It is a record specific enough that a later reader can check.
