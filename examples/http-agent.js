"use strict";
// Example: HTTP-calling agent with ORF v0.2 receipts.
//
// This example shows how world_state_read differs for HTTP actions:
// capture the response state (status code, relevant fields) — not just the URL.
// The URL is not state. The response is state.
//
// Also shows a URI typed falsifier, which a future agent can resolve
// without trusting the author's claim.
//
// Run: node examples/http-agent.js
// Uses a simulated HTTP client (no real network calls in this example).

const orf = require("../reference/helper");
const fs = require("fs");
const os = require("os");
const path = require("path");

const LEDGER = path.join(os.tmpdir(), "orf-http-agent-example.jsonl");
const AGENT = "http-agent-example";
const ENDPOINT = "https://api.example.com/config";

// Simulated HTTP client — replace with fetch/axios/node:http in a real agent.
function simulatedGet(url) {
  if (url === ENDPOINT) return { status: 200, body: { version: 1, last_sync: "2026-06-18T07:00:00Z" } };
  if (url === `${ENDPOINT}?check`) return { status: 200, body: { version: 2 } };
  return { status: 404, body: null };
}

function simulatedPost(url, _body) {
  if (url === ENDPOINT) return { status: 200, body: { version: 2, accepted: true } };
  return { status: 500, body: null };
}

function loadLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function emit(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

// ─── Boot: reconcile any open decision ────────────────────────────────────────
const ledger = loadLedger(LEDGER);
const lastDecision = ledger.filter((r) => r.record === "decision").slice(-1)[0];
const alreadyReconciled =
  lastDecision && ledger.some((r) => r.record === "reconcile" && r.open_decision_id === lastDecision.id);

if (lastDecision && !alreadyReconciled) {
  // Check the world state on wake. For an HTTP action, re-read the endpoint.
  // world_state_read must capture what you actually observed, not what you expected.
  const probe = simulatedGet(`${ENDPOINT}?check`);
  const stateNow = `GET ${ENDPOINT}?check status=${probe.status} version=${probe.body?.version ?? "null"}`;
  const gapDetected = !(probe.status === 200 && probe.body?.version === 2);

  const rec = emit(
    LEDGER,
    orf.reconcile(`reconcile-${lastDecision.id}`, {
      openDecisionId: lastDecision.id,
      worldStateRead: stateNow,
      gapDetected,
      resolution: gapDetected ? "not_completed" : "completed",
      notes: gapDetected
        ? "endpoint did not reflect the posted update — safe to retry with same idempotency key"
        : ""
    })
  );
  console.log(`[boot] reconcile: ${rec.resolution} (gap=${gapDetected})`);
}

// ─── Read world state before deciding ─────────────────────────────────────────
// world_state_read for an HTTP action: capture what you read, not what you assume.
const current = simulatedGet(ENDPOINT);
const worldStateRead = `GET ${ENDPOINT} status=${current.status} version=${current.body?.version ?? "null"} last_sync=${current.body?.last_sync ?? "unknown"}`;
console.log(`[read] ${worldStateRead}`);

// ─── Decide ───────────────────────────────────────────────────────────────────
const decisionId = `post-config-v2-2026-06-19`;
const payload = { version: 2, retry_budget_ms: 500 };

const dec = emit(
  LEDGER,
  orf.decision(decisionId, {
    actor: AGENT,
    intent: "Post config v2 to reduce retry noise",
    precondition: worldStateRead,
    rule: "post when current version < 2",
    action: `POST ${ENDPOINT}`,
    // action_idempotency_key: present this to the endpoint if it supports idempotency headers.
    idempotencyKey: "config-v2-2026-06-19",
    // URI falsifier: "GET the endpoint; if version is NOT 2, the action did not complete."
    // This is checkable by any agent with HTTP access, without trusting the author.
    falsifier: {
      type: "uri",
      value: `GET ${ENDPOINT} — field version != 2`,
      window_seconds: 3600
    },
    confidence: 0.88,
    reconClass: "irrecoverable" // a POST that changes remote state cannot be undone by us
  })
);
console.log(`[decide] ${dec.id}`);

// ─── Act ──────────────────────────────────────────────────────────────────────
const response = simulatedPost(ENDPOINT, payload);

// ─── Outcome ──────────────────────────────────────────────────────────────────
// Check the falsifier: does the endpoint now show version=2?
// falsifierObserved=false means "the falsifying condition did NOT occur" → status=held.
const check = simulatedGet(`${ENDPOINT}?check`);
const falsifierObserved = !(check.status === 200 && check.body?.version === 2);

emit(
  LEDGER,
  orf.outcome(decisionId, {
    observedResult: `POST returned status=${response.status}; read-back version=${check.body?.version ?? "null"}`,
    falsifierObserved
  })
);
console.log(`[outcome] status=${falsifierObserved ? "falsified" : "held"}`);

// ─── Show the ledger ──────────────────────────────────────────────────────────
console.log("\n--- ledger ---");
for (const r of loadLedger(LEDGER)) {
  console.log(JSON.stringify(r, null, 2));
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(LEDGER, { force: true });
