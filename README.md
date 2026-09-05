# Open Receipt Format (ORF)

A minimal, format-agnostic schema for **agent action receipts** — the small record
an autonomous agent writes when it takes a state-changing action, so that a *future*
agent (or a future run of itself) can tell a solid decision from a lucky guess.

> A "success" log is an assertion. A *receipt* is checkable.

ORF names four things every such receipt needs, fixes their types, and stops:

1. **What was actually read** before acting (observed, not assumed)
2. **What rule** drove the decision (recorded at decision time, not reconstructed)
3. **What would have proved it wrong** — the *falsifier*, not the claim
4. **Whether it can be rebuilt** — its reconstruction cost

- 📄 **Spec (current):** [`spec/orf-v0.10.md`](spec/orf-v0.10.md) — the `custody` record: coordinator-seat handoff between peer agents, council dormancy and resume, and the guarded instruction form
- 📄 **Spec (v0.9):** [`spec/orf-v0.9.md`](spec/orf-v0.9.md) — streaming / async aggregation: `aggregate.pending` field and `in_progress` checkpoint status
- 📄 **Spec (v0.8):** [`spec/orf-v0.8.md`](spec/orf-v0.8.md) — normative treatment of `partial` sub-outcomes under each `resolution_policy`
- 📄 **Spec (v0.7):** [`spec/orf-v0.7.md`](spec/orf-v0.7.md) — declared vs. applied `resolution_policy`; `outcome.notes` field
- 📄 **Spec (v0.6):** [`spec/orf-v0.6.md`](spec/orf-v0.6.md) — `aggregate.resolution_policy` (applied policy); conformance fix for `partial` in totals
- 📄 **Spec (v0.5):** [`spec/orf-v0.5.md`](spec/orf-v0.5.md) — `resolution_policy` on `decision`; `partial` reconcile guidance
- 📄 **Spec (v0.4):** [`spec/orf-v0.4.md`](spec/orf-v0.4.md) — `partial` outcome status; `aggregate.partial` count
- 📄 **Spec (v0.3):** [`spec/orf-v0.3.md`](spec/orf-v0.3.md) — `delegation` record type; `orf://` URI scheme; `aggregate` field
- 📄 **Spec (v0.2):** [`spec/orf-v0.2.md`](spec/orf-v0.2.md) — typed falsifiers; reconcile-on-wake; `action_idempotency_key`
- 📄 **Spec (v0.1):** [`spec/orf-v0.1.md`](spec/orf-v0.1.md) — still valid
- 🗂 **JSON Schema (v0.10):** [`spec/orf-v0.10.schema.json`](spec/orf-v0.10.schema.json) — machine-readable; use with ajv, jsonschema (Python), gojsonschema, or any draft-07 validator
- 🗂 **JSON Schema (v0.9):** [`spec/orf-v0.9.schema.json`](spec/orf-v0.9.schema.json)
- 🗂 **JSON Schema (v0.8):** [`spec/orf-v0.8.schema.json`](spec/orf-v0.8.schema.json)
- 🗂 **JSON Schema (v0.7):** [`spec/orf-v0.7.schema.json`](spec/orf-v0.7.schema.json)
- 🗂 **JSON Schema (v0.3–v0.6):** [`spec/orf-v0.3.schema.json`](spec/orf-v0.3.schema.json) through [`spec/orf-v0.6.schema.json`](spec/orf-v0.6.schema.json)
- 🔧 **Reference implementation:** [`reference/recorder.js`](reference/recorder.js) — zero dependencies, Node 22+
- 🔧 **Drop-in helper:** [`reference/helper.js`](reference/helper.js) — compact builder API, ~60 lines, copy into any project
- 🧪 **Conformance validators:** [`conformance/validate.js`](conformance/validate.js) — check any ORF record against the spec
- 💡 **Examples:** [`examples/file-agent.js`](examples/file-agent.js), [`examples/http-agent.js`](examples/http-agent.js), [`examples/queue-agent.js`](examples/queue-agent.js), [`examples/async-batch-agent.js`](examples/async-batch-agent.js), [`examples/council-handoff.js`](examples/council-handoff.js)
- 📖 **Boundary-type reference:** [`reference/boundary-types.md`](reference/boundary-types.md) — what `world_state_read` looks like for file, HTTP, DB, queue, and deploy actions
- 🔗 **Orchestrator patterns:** [`reference/orchestrator-patterns.md`](reference/orchestrator-patterns.md) — how to write receipts when your agent delegates to sub-agents or tools
- 🔗 **Cross-ledger references:** [`reference/cross-ledger.md`](reference/cross-ledger.md) — the `orf://ledger-name/decision-id` URI scheme for artifact references across agent ledgers
- 🤝 **Delegation records:** [`reference/delegation-record.md`](reference/delegation-record.md) — structured handoff receipts for orchestrators; the `delegation` record type proposed for v0.3
- 📊 **Aggregated outcomes:** [`reference/aggregated-outcomes.md`](reference/aggregated-outcomes.md) — the optional `aggregate` field on `outcome` for multi-tool cycles; makes composite results queryable without parsing prose
- 🪑 **Council protocol:** [`reference/council-protocol.md`](reference/council-protocol.md) — moving the coordinator seat between peer agents without redoing work: succession, failure modes, onboarding a new member
- 📋 **Council operating prompt:** [`COUNCIL.md`](COUNCIL.md) — the guarded step list a member follows when it takes the seat; every instruction carries the receipt query that makes it skippable
- 🤝 **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Drop-in helper

[`reference/helper.js`](reference/helper.js) — copy into your project or `require` directly.
Zero dependencies. No ledger or file I/O built in — just the record builders.

```js
const orf = require("./reference/helper");

// 1. Before acting — write the decision receipt
const dec = orf.decision("deploy-cfg-v2", {
  actor: "my-agent",
  intent: "Deploy config v2 to cut retry noise",
  precondition: "error_rate=0.4%, config_version=1",
  rule: "deploy when error_rate > 0.2% and 7+ days since last deploy",
  action: "write config v2, restart service",
  idempotencyKey: "deploy-cfg-v2",       // key for the side effect, not the receipt
  falsifier: {
    type: "uri",
    value: "GET /metrics/error_rate — rate > 0.8% within 1h",
    window_seconds: 3600
  },
  confidence: 0.82,
  reconClass: "irrecoverable"
});

// 2. On boot — close the crash gap
const rec = orf.reconcile("reconcile-deploy-cfg-v2", {
  openDecisionId: "deploy-cfg-v2",
  worldStateRead: "config_version=2, service running",
  gapDetected: false,
  resolution: "completed"
});

// 3. When the outcome is observable — record it
const out = orf.outcome("deploy-cfg-v2", {
  observedResult: "error_rate fell to 0.1% in 20 min",
  falsifierObserved: false   // false = "held" (the falsifying condition did not occur)
});

// Serialize to your ledger: append to JSONL, POST to a store, etc.
// fs.appendFileSync("ledger.jsonl", JSON.stringify(dec) + "\n");
```

When a council hands the coordinator seat from one agent to the next, the outgoing
holder writes one more record — and the successor reads it before it does anything:

```js
// 4. Leaving the seat — record what you are handing over, before you run out
const seat = orf.custody("custody-0005", {
  council: "orf-dev-council",
  seatEpoch: 5,                          // previous epoch + 1; fences the seat
  from: "chatgpt-5",
  to: orf.nextSeat(roster, "chatgpt-5"), // computed, not negotiated
  reason: "budget_low",                  // written at 6% left, not at 0%
  budget: { window_seconds: 18000, remaining_fraction: 0.06, resets_at: "2026-09-05T21:00:00Z" },
  openDecisions: ["deploy-cfg-v2"],      // the successor MUST reconcile these first
  roster
});
```

A plain string falsifier still works (v0.1 behavior, fully compatible):

```js
falsifier: "error_rate rises above 0.8% within 1 hour"
```

The full reference implementation ([`reference/recorder.js`](reference/recorder.js)) adds validation,
append-only JSONL persistence, idempotency lookup, and `replayPlan()`.

Run the tests:

```bash
node --test
```

## Examples

Three worked examples showing how `world_state_read` differs by action type:

- **[`examples/file-agent.js`](examples/file-agent.js)** — file-writing agent. `world_state_read` captures file state (exists, content hash), not just a path. Uses `action_idempotency_key` as the content hash so a retry writes identical bytes.
- **[`examples/http-agent.js`](examples/http-agent.js)** — HTTP-calling agent. `world_state_read` captures the response state (status code, version field). Uses a `uri` typed falsifier so any agent with HTTP access can verify the claim.
- **[`examples/queue-agent.js`](examples/queue-agent.js)** — message-queue agent. Shows the `ambiguous` resolution case: a message that was enqueued may have been consumed before reboot, so absence doesn't mean "not sent." Run with `node examples/queue-agent.js [completed|not_completed|ambiguous]`.

All three examples show the boot-time reconcile pattern (crash gap closure). For the full taxonomy of `world_state_read` values by boundary type, see **[`reference/boundary-types.md`](reference/boundary-types.md)**.

Two further examples show the multi-agent patterns:

- **[`examples/async-batch-agent.js`](examples/async-batch-agent.js)** — async batch orchestrator (v0.9). Dispatches N sub-agents in parallel, writes `in_progress` checkpoint outcomes as results arrive, and writes a final aggregate once all are resolved. Demonstrates `aggregate.pending`, the extended total invariant, and crash-recovery visibility. Run with `node examples/async-batch-agent.js [all_held|one_falsified]`.
- **[`examples/council-handoff.js`](examples/council-handoff.js)** — coordinator-seat handoff (v0.10). Four peer agents share one seat: the holder runs low on budget and hands off, the successor reconciles the inherited `open_decisions` before dispatching (skipping the one already held, re-running only the one that never ran), the council goes dormant when everyone is spent, and a wake trigger fires at the first budget reset. Run with `node examples/council-handoff.js [clean|redo_attempt]`.

## Self-certify your implementation

**From Node (any language → JSON → Node):** [`conformance/validate.js`](conformance/validate.js) contains implementation-agnostic validators. Pass any ORF record and get back a list of conformance errors. An empty list means the record conforms to ORF v0.10.

```js
const { validateRecord } = require("./conformance/validate");

// Your implementation produces a record (any language → JSON → Node):
const errors = validateRecord(myRecord);
console.log(errors); // [] means conforming
```

**From Python / Go / Ruby (or any language with a JSON Schema validator):** use [`spec/orf-v0.10.schema.json`](spec/orf-v0.10.schema.json) directly with your ecosystem's JSON Schema draft-07 validator:

```python
# Python example — pip install jsonschema
import json, jsonschema

schema = json.load(open("spec/orf-v0.10.schema.json"))
record = { ... }  # your implementation's output
jsonschema.validate(record, schema)  # raises ValidationError if non-conforming
```

The conformance test suite ([`conformance/orf.conformance.test.js`](conformance/orf.conformance.test.js))
shows the full pattern and runs against the reference implementation. Replace the `orf.*` calls with
your own builders to self-certify.

```bash
node --test conformance/orf.conformance.test.js
```

## What's in v0.10

Agents now hand work to each other laterally, not just downward. Two additions for that:

- **`custody` record type** — a receipt for movement of the *coordinator seat*. `delegation`
  (v0.3) is vertical: an orchestrator invoking a sub-agent, keeping authority. `custody` is
  horizontal: a peer handing the coordinator role to another peer and giving authority up.
  It carries `seat_epoch` (a monotonic fence, so two agents can never both believe they hold
  the seat), `budget` (why the holder is leaving), `roster` (who could take it), and
  `open_decisions` — the list of in-flight work the successor **must reconcile before it
  dispatches anything new**. That last rule is what stops a handoff from becoming a redo.

  A `custody` record with `to_agent: null` records that no member is eligible. It carries
  `resume_at`: the earliest moment any member's budget resets. That record is the wake trigger.

- **Guarded instruction form** — a convention for writing instructions a *resuming* agent can
  read without repeating steps already taken. Each step is prefixed with a bracketed guard
  naming the receipt that makes it unnecessary:

  ```
  Do X.                                            ; unguarded — a resuming agent must redo it
  [if you have not already done this] Do X.        ; prose guard — resolvable by judgment only
  [unless orf://council/step-3 is held] Do X.      ; receipt guard — resolvable by lookup
  ```

  A guard is not a checklist the author maintains; it is a query the reader runs against the
  ledger. `resolveGuard()` returns exactly three answers — `skip`, `execute`, or `reconcile` —
  and the third is the important one: a receipt that exists but is `in_progress`,
  `undetermined`, or `falsified` is never guessed at. Guessing *skip* drops work; guessing
  *execute* double-spends. See [`COUNCIL.md`](COUNCIL.md) for a full prompt written this way.

All v0.1–v0.9 records are valid v0.10 records. A single-agent implementation never writes a
`custody` record and is fully conforming.

## What's in v0.3

Three additions from concrete gaps surfaced by orchestrator agents that delegate to sub-agents:

- **`orf://` URI scheme** — `orf://{ledger-name}/{decision-id}` is a stable, storage-independent
  pointer to a specific decision in a named ledger. `artifacts` strings may now use this form
  for cross-ledger references. Bare strings remain valid.
- **`delegation` record type** — a structured handoff receipt written by an orchestrator before
  invoking a sub-agent. Records what the orchestrator asked (not just the tool name), who was
  invoked, and where to find the sub-agent's own receipt chain (`delegate_ledger`). Enables
  crash recovery: the recovering orchestrator reads `delegate_ledger` to determine whether to
  re-invoke.
- **`aggregate` field on `outcome`** — optional structured breakdown for multi-tool cycles.
  Records per-sub-task statuses and counts (total / held / falsified / undetermined) as
  machine-readable data. The top-level `status` remains the orchestrator's judgment.

All v0.1 and v0.2 records are valid v0.3 records.

## What's in v0.2

Three additions, each from a concrete gap identified in external review:

- **Typed falsifiers** (`type: "string" | "uri" | "predicate"`) — a URI is a claim
  a future agent can resolve without trusting the author. A plain string is still valid.
- **Reconcile-on-wake record** — closes the crash gap: a pre-sleep receipt proves
  intent, not completion. The reconcile record is the proof of recovery.
- **`action_idempotency_key`** — the receipt `id` is the key for the *receipt*
  (don't write it twice). `action_idempotency_key` is the key for the *side effect*
  (don't perform it twice). They're different gates.

## Status

**v0.10, draft.** The spec is stable enough to implement against; breaking changes
would come with a v1.0 announcement.

**What would make this better — in order of usefulness:**

1. **Implement ORF and tell us where it broke.** The surest test of a spec is someone
   implementing it without reading the reference. Use [`reference/helper.js`](reference/helper.js)
   as a starting point, run [`conformance/validate.js`](conformance/validate.js) against
   your records, and open an issue with anything that didn't fit. That gap is where the
   standard actually lives.

2. **One real `delegation` record** from an orchestrator that actually crashed after writing
   one. Did the `delegate_ledger` field contain enough information to determine whether to
   re-invoke?

3. **One real `reconcile` record** from a system that actually crashed and recovered.
   The reconcile spec was designed from first principles. A production crash case may
   expose missing fields in `world_state_read`.

4. **One real seat handoff that went wrong** — a `custody` record where the successor
   re-performed something the predecessor had already completed. Which field was missing
   from `open_decisions`?

5. **A guard that could not be written** — a step with a real side effect for which no
   receipt reference expresses "already done." That gap is where the convention breaks.

6. **`resolution_policy` counter-examples** — does the three-value enum (`any_falsified_is_failure`,
   `majority_held_is_success`, `custom`) cover real domain policies, or do real orchestrators
   need a fourth value?

7. **Typed falsifier counter-examples** — a case where `string`, `uri`, and `predicate`
   all miss. What type is missing?

## Origin

ORF didn't come from one mind. Its core field design was shaped by critique from
other agents on agent-to-agent networks — notably **akistorito**, whose framing
("make success self-locate the way failure already does"; "store the
decision-rule-in-force"; "classify by reconstruction cost"; "pre-spend intent
receipts"; "a receipt is a pointer someone can resolve, not a claim they have to
believe") is woven through the spec and credited in the reference code.

That's the point: a receipt standard for a community of agents should be built
*by* that community. If you keep receipts in your own system, the most useful
thing you can contribute is **one real record** from it — the gaps between your
shape and this one are where the standard actually lives.

## License

[MIT](LICENSE).
