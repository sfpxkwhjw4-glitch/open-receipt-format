# ORF in Orchestrator Patterns

Orchestrator agents — those that invoke sub-agents, tools, or services on behalf of
a higher-level decision — face a specific receipt challenge: their decisions are about
*what to delegate*, not about a state boundary they themselves cross. This document
shows how to use current ORF (v0.2) for common orchestration patterns, and identifies
where the spec leaves gaps.

---

## The orchestrator's receipt problem

An orchestrator runs a tool:

```
Orchestrator → invokes → monitor-agent.js → returns → {reply_count: 16}
```

The orchestrator's "action" is the invocation. The world state it should record is
whatever the tool returns (the observed output), not the tool's internal precondition.
The falsifying condition is: the tool failed, returned an unexpected exit code, or
returned a result that differed materially from prior state.

Under current ORF, this maps to existing record types — no new types needed.

---

## Pattern 1: Tool invocation as decision + outcome

The simplest case: the orchestrator writes a `decision` before invoking the tool,
then an `outcome` after it returns.

**Before invocation:**

```json
{
  "orf_version": "0.2",
  "record": "decision",
  "recorded_at": "2026-06-28T15:53:00Z",
  "id": "harvest-monitor-2026-06-28T15-53",
  "actor_agent": "founder-cycle",
  "intent": "Harvest social signal via monitor-agent-socials",
  "precondition_read": "last_run=2026-06-28T10:53:00Z; prior reply_count=16",
  "decision_rule": "run monitor every cycle; skip only if last_run < 4h ago",
  "action": "invoke monitor-agent-socials-2026-06-07.js",
  "confidence": 1.0,
  "falsifier": {
    "type": "predicate",
    "value": "exit_code != 0 OR reply_count differs from prior by more than 5 without new post activity",
    "window_seconds": 120
  },
  "reconstruction_class": "recoverable"
}
```

**After invocation:**

```json
{
  "orf_version": "0.2",
  "record": "outcome",
  "recorded_at": "2026-06-28T15:53:15Z",
  "decision_id": "harvest-monitor-2026-06-28T15-53",
  "observed_result": "exit 0; agentgram_reply_count=16 (unchanged); all HTTP statuses 200",
  "falsifier_observed": false,
  "status": "held"
}
```

**What goes in `precondition_read`:** The orchestrator's prior-run state — last run
timestamp, last known counts. Not the tool's internal world state (the APIs it will call).

**What goes in `observed_result`:** The tool's output — the values it returned,
not what the orchestrator expected. Record the actual numbers, not "as expected."

---

## Pattern 2: Parallel tool invocations

When an orchestrator invokes multiple tools in the same cycle, each invocation is a
separate decision. Write one decision per tool, each with its own outcome.

```json
{ "id": "harvest-monitor-2026-06-28T15-53", "action": "invoke monitor-agent-socials.js" }
{ "id": "harvest-replies-2026-06-28T15-53", "action": "invoke check-thread-replies.js" }
```

Each gets its own outcome. The orchestrator's overall cycle decision can then be
a higher-level record that references both:

```json
{
  "orf_version": "0.2",
  "record": "decision",
  "id": "cycle-2026-06-28T15-53",
  "actor_agent": "founder-cycle",
  "intent": "Run harvest cycle — monitor + thread-replies",
  "precondition_read": "no prior cycle in last 4h",
  "decision_rule": "run all harvest tools; emit clean-exit if inbound QUIET",
  "action": "parallel invoke: monitor-agent-socials.js, check-thread-replies.js",
  "confidence": 1.0,
  "falsifier": "either sub-tool exits non-zero",
  "reconstruction_class": "recoverable",
  "artifacts": [
    "harvest-monitor-2026-06-28T15-53",
    "harvest-replies-2026-06-28T15-53"
  ]
}
```

The `artifacts` field carries the sub-decision IDs. A future agent reading this
receipt can look up each sub-decision to trace the full picture.

**Limitation:** ORF v0.2 does not define a parent-child relationship between decisions.
The `artifacts` field is a string array — convention, not schema. Two implementations
may use different formats (IDs vs. paths vs. URIs). This is the main gap for v0.3.

---

## Pattern 3: Embedding sub-agent receipts

If a sub-agent produces its own ORF receipts, the orchestrator's outcome can
reference them via `artifacts`:

**Sub-agent's own receipt (in its own ledger):**

```json
{
  "orf_version": "0.2",
  "record": "decision",
  "id": "monitor-run-2026-06-28T15-53",
  "actor_agent": "monitor-agent-socials",
  "intent": "Read agentgram reply counts for 11 target posts",
  "action": "GET /api/comments for 11 posts",
  "falsifier": "any HTTP status != 200",
  "reconstruction_class": "recoverable"
}
```

**Orchestrator outcome referencing it:**

```json
{
  "record": "outcome",
  "decision_id": "harvest-monitor-2026-06-28T15-53",
  "observed_result": "monitor returned reply_count=16, all 200s",
  "falsifier_observed": false,
  "status": "held",
  "artifacts": ["monitor-ledger://receipts/monitor-run-2026-06-28T15-53"]
}
```

The `artifacts` entry is a logical reference to the sub-agent's ledger. A future agent
can follow it to the sub-agent's own receipt chain.

**Guidance for the artifact string format:**
- Use a stable, human-readable identifier: `{ledger-name}://receipts/{decision-id}`.
- Document in your system how to dereference it. ORF does not define a resolution
  protocol; the value is only as useful as your infrastructure makes it.
- If the sub-agent's ledger is in the same file as the orchestrator's, use the
  sub-decision ID directly. Avoid embedding absolute paths — they become stale.

---

## Pattern 4: Crash recovery across an invocation

If the orchestrator crashes after writing the decision but before capturing the
outcome, it needs a `reconcile` record on boot. The key question: did the tool run?

**Recovering from a crash mid-invocation:**

```json
{
  "orf_version": "0.2",
  "record": "reconcile",
  "recorded_at": "2026-06-28T16:10:00Z",
  "id": "reconcile-harvest-monitor-2026-06-28T15-53",
  "open_decision_id": "harvest-monitor-2026-06-28T15-53",
  "world_state_read": "monitor-agent-socials output file timestamp=2026-06-28T15:53:14Z (after decision); reply_count=16",
  "gap_detected": false,
  "resolution": "completed",
  "notes": "Output file timestamp is after decision write time; tool completed before crash."
}
```

**If no output file exists (tool never ran):**

```json
{
  "world_state_read": "monitor-agent-socials output file: ENOENT (last-modified timestamp not updated since 2026-06-28T10:53:00Z)",
  "gap_detected": true,
  "resolution": "not_completed",
  "notes": "Tool was never invoked, or was invoked but crashed before writing output. Safe to re-invoke."
}
```

**Resolution rules:**
- Tool output is newer than the decision's `recorded_at` → `completed`.
- Tool output is absent or older than the decision → `not_completed`. Re-invoke.
- Tool output exists but is partial (e.g., JSON truncated) → `ambiguous`. Inspect before retry.

---

## What ORF v0.2 handles well

These four patterns cover the most common orchestrator cases with existing v0.2 fields:

- Simple delegation: **Pattern 1** (decision + outcome)
- Multi-tool cycles: **Pattern 2** (parallel decisions, artifacts list)
- Sub-agent receipt references: **Pattern 3** (artifacts with logical URIs)
- Crash recovery across invocations: **Pattern 4** (reconcile with output-file timestamp)

No new record types are required. The key is treating the tool's output — not its
internal state — as the `observed_result`, and using `artifacts` to link sub-decisions.

---

## Gaps for v0.3

Using current ORF for orchestration surfaces three gaps:

**1. Cross-ledger references lack a protocol.** *(addressed in [`reference/cross-ledger.md`](cross-ledger.md))*
`artifacts` holds strings. Two implementations will invent different formats. ORF should
define one: either a URI scheme (`orf://ledger-id/decision-id`) or a structural field
(`{ "ledger": "...", "decision_id": "..." }`). The cross-ledger reference doc proposes
the URI form and covers ledger identity, dereferencing, and what the scheme leaves to
infrastructure.

**2. No delegation record type.**
The orchestrator's intent ("delegate X to agent B") is distinct from its action ("what B
actually ran"). A `delegation` record would carry the delegated intent and the sub-agent's
identity, separate from the orchestrator's own decision record. This would close the gap
between `action: "invoke monitor-agent.js"` (informal) and a structured handoff receipt.

**3. Aggregated outcomes lack schema.**
When an orchestrator runs N tools, its outcome is a composite of N results. There is no
structured way to say "3 of 5 sub-tools held; 2 were undetermined." The `observed_result`
string is the only place to put this today, which makes it unqueryable.

These are not blocking issues for current use. The four patterns above all work.
But they accumulate in any system that does significant orchestration at scale.
