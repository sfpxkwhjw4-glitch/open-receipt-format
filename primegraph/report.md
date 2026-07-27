# Falsification report — prime-divisibility graph

Scope: **E1 and E3 only**, as instructed. E2, E4–E7 were not run; see
"What was not run" at the end.

Every number below is from `results/*.csv`, produced by the modules in
`primegraph/`. Nothing is taken from a docstring or from the original build.

---

## Headline

**Both headline results are design choices.**

The anchor's dominance in betweenness is not caused by the hand-added edges,
and it is not a fact about arithmetic. It is the 1/p degree profile:
node 2 has `floor(N/2) - 1` neighbours, and a random graph with the same
degree sequence gives it the same betweenness to within 0.3%
(observed 0.8790, null mean 0.8812 ± 0.0075, z = −0.30, p = 0.74; N = 10³,
padic, hub edges on).

The eigenvector result is weaker than that. The graph's top eigenvector node
is a prime in 36 of 36 configurations — never 30, 210, or 330. Those are the
top *composite* nodes, they are not stable in N, and they are not stable
under the weighting choice. The whole top-20 by eigenvector in the as-built
configuration is the first twenty primes in ascending order, 15 of which sit
inside |z| < 2 of the degree-preserving null and none of which exceeds it by
more than 1.1%.

---

## E1 — HUB ABLATION

**Claim tested.** The anchor tops betweenness because of the hand-added
anchor–prime edges. Falsification hypothesis from the brief: the dominance is
just density of multiples, |multiples of p| ≈ N/p.

**Result.** Sweep of N ∈ {10³, 3162, 10⁴, 31623, 10⁵, 10⁶} × weighting ∈
{padic, uniform, log} × hub_edges ∈ {True, False}, anchor 2. Betweenness is
exact to N = 10⁴ and k-sampled above it (250 pivots × 3 replicates, standard
error reported per node). Files: `results/e1_hub_ablation.csv`,
`results/figures/e1_hub_ablation.png`.

The anchor is betweenness rank 1 in **15/15** configurations with hub edges
and **10/15** without. All five failures are the `log` weighting, where
cost = 1/log p makes large-prime edges cheap and the top goes to 3, 5, or 7.
Under `padic` — the weighting actually used — the anchor is rank 1 at every N
with the hub edges deleted:

| weighting | N | anchor betweenness, hub on | hub off | rank on → off |
|---|---|---|---|---|
| padic | 10³ | 0.8885 | 0.5910 | 1 → 1 |
| padic | 10⁴ | 0.8902 | 0.6016 | 1 → 1 |
| padic | 10⁵ | 0.8900 | 0.5999 | 1 → 1 |
| uniform | 10⁵ | 0.8302 | 0.5361 | 1 → 1 |
| log | 10⁵ | 0.9878 | 0.0609 | 1 → 5 |

Deleting the hub edges costs the anchor about a third of its score and none
of its rank. **The hand-added edges are not the cause.**

The brief's falsification hypothesis is the one that holds. Across prime
nodes, log-betweenness regressed on log-degree in the exact regime (N ≤ 10⁴)
gives R² = 0.983–0.988 under padic, 0.984–0.989 under uniform and
0.932–0.982 under log, and Kendall
τ(betweenness, degree) = 0.979–1.000 with hub edges off. Degree of a prime is
exactly `floor(N/p) - 1`. The R² values fall to 0.79–0.96 at N ≥ 31623, which
is where betweenness switches from exact to 250-pivot sampling; that is a
property of the estimator, not of the graph.

**Verdict: ARTIFACT.** The dominance survives the ablation, so the stated
mechanism is wrong, and the surviving explanation is the degree sequence.

### E1b — the same ablation applied to the eigenvector claim

Files: `results/e1_eigen_focus.csv`, `results/figures/e1_eigen_focus.png`.
Spectral metrics only, so this covers the full sweep to N = 10⁶.

The global eigenvector top node is a prime in **36/36** configurations
(node 2, or node 5 under log weighting with hub edges off). 30, 210 and 330
are top *composites*. Their composite-rank moves with N:

| node | N=10³ | N=3162 | N=10⁴ | N=31623 | N=10⁵ | N=10⁶ |
|---|---|---|---|---|---|---|
| 210 (uniform, hub on) | 1 | 13 | 38 | 302 | 1544 | 8566 |
| 330 (uniform, hub on) | 6 | 19 | 71 | 348 | 1725 | 15140 |
| 30 (uniform, hub on) | 39 | 162 | 837 | 3544 | 10103 | 51078 |

What sits at the top instead is always the largest primorial below N and its
small multiples: 210 and 630 at N = 10³, 2310 at 3162, 2310/6930/9240 at 10⁴,
30030 at 10⁵, 510510 at 10⁶. Under `padic` weighting the top composites are
not primorials at all but powers of two — 512, 8192, 65536, 524288 — and 210
falls to composite-rank 268501 at N = 10⁶.

So "eigenvector centrality surfaces 30, 210, 330" is a statement about one
value of N (≈10³) under one of the three weightings. Change N by a decade or
change the weighting and different nodes appear.

**Verdict: ARTIFACT.**

---

## E3 — CONFIGURATION-MODEL NULL

**Claim tested.** The centrality of the top nodes encodes something beyond the
degree sequence.

**Null.** Bipartite-aware degree-preserving rewiring, 100 samples per
configuration. Every node keeps its exact degree, divisibility edges stay
prime–non-prime, hub edges stay anchor–prime, and the multiset of edge costs
is preserved; only which multiple of p an edge points at is randomized. The
real graph and all 100 nulls share one fixed pivot set for betweenness, so
pivot noise cannot show up as a real-vs-null difference. Files:
`results/e3_config_null.csv`, `results/e3_config_null_spectral.csv`,
`results/e3_config_null_swap40.csv`, `results/figures/e3_config_null*.png`.

**Validity checks.** Degree returns z = 0.00 for every node in every
configuration, as it must. Quadrupling the rewiring intensity (swap factor
10 → 40) moves the null means by at most 1.3%, and by ≤0.3% in the padic and
uniform configurations; node 2's betweenness z moves from −0.297 to −0.323.
The chain is mixed.

**Result — the betweenness headline.** Node 2, against its own null:

| N | weighting | hub | observed | null mean ± sd | z | p (empirical) | rel. dev. |
|---|---|---|---|---|---|---|---|
| 10³ | padic | on | 0.8790 | 0.8812 ± 0.0075 | −0.30 | 0.74 | 0.25% |
| 10⁴ | padic | on | 0.8950 | 0.8847 ± 0.0083 | +1.24 | 0.16 | 1.2% |
| 10³ | uniform | on | 0.8282 | 0.8251 ± 0.0080 | +0.39 | 0.56 | 0.38% |
| 10⁴ | uniform | on | 0.8317 | 0.8250 ± 0.0088 | +0.76 | 0.36 | 0.81% |
| 10³ | padic | off | 0.5805 | 0.5666 ± 0.0165 | +0.84 | 0.46 | 2.4% |
| 10⁴ | padic | off | 0.6225 | 0.5882 ± 0.0170 | +2.02 | 0.02 | 5.8% |

**|z| < 2 for the top node in the as-built configuration, at both N.** The
verdict condition set in advance is met. Node 2's betweenness of ≈0.88 is what
a random graph with the same degree sequence produces. With hub edges removed
the anchor runs a few percent above its null (z 0.84 → 2.02), so there is a
small real excess there, but the baseline the excess sits on is 0.57–0.59 of a
maximum of 1.0 — the null already supplies almost all of the score.

**Result — the eigenvector headline.** Top-20 by eigenvector at N = 10⁴,
uniform, hub on, is the first twenty primes in ascending order. Relative
deviation from the null is ≤1.04% for all twenty; 15 of 20 have |z| < 2. The
two largest are node 5 (z = +2.75, +1.04%) and node 7 (z = +2.56, +0.90%).

Node 2's eigenvector centrality reaches |z| = 32.6 at N = 10⁵ — on a relative
deviation of **0.006%** (0.706505 vs 0.706545). The z-score inflates purely
because the null standard deviation collapses with N (1.2×10⁻⁵ → 1.4×10⁻⁶)
while the offset stays fixed. Reported as z alone this looks like a strong
result; it is a difference in the fifth decimal place.

**Where the null genuinely fails.** In `e3_config_null.csv`, 329 node-rows
have |z| > 2, and 96% of those carry a relative deviation above 1%, so they
are not all small-sd artifacts. The largest are, without exception,
prime-power-rich composites
under `padic` weighting with hub edges off: 7776 = 2⁵·3⁵ (observed 0.1051 vs
null 0.00001), 8000 = 2⁶·5³, 9261 = 3³·7³, 5488 = 2⁴·7³, 7744 = 2⁶·11².
Under `padic` the cost 1/(1+v_p(n)) makes a high-valuation edge very cheap, so
these nodes become cheap through-routes between small primes; a rewiring
scatters the cheap edges and no node collects two of them. That is the cost
function talking, and it is reproducible, but none of these is a node in
either headline claim.

**Verdict: ARTIFACT** for both headline claims. The anchor's betweenness meets
the pre-stated |z| < 2 condition; the top of the eigenvector ranking is the
primes in degree order and sits within ~1% of the null.

---

## Consolidated verdicts

| Experiment | Claim | Verdict |
|---|---|---|
| E1 | anchor dominance is caused by the hand-added edges | **ARTIFACT** — dominance survives the ablation; R² = 0.98–0.99 of log-betweenness on log-degree over primes |
| E1b | eigenvector surfaces 30, 210, 330 | **ARTIFACT** — top node is a prime in 36/36 runs; those three drift from composite-rank 1 to 8566 across the N sweep, and vanish entirely under padic weighting |
| E3 | top-node centrality encodes more than the degree sequence | **ARTIFACT** — node 2's betweenness z = −0.30 (p = 0.74) in the as-built config; top-20 eigenvector within 1.04% of null |

E1–E3 come back ARTIFACT. The headline results are design choices: the
betweenness ordering is the 1/p degree profile, and the eigenvector nodes are
set by where the truncation window N falls relative to the primorials and by
which of the three weightings is used.

## Caveats on the numbers

- Betweenness above N = 10⁴ is estimated from 250 pivots × 3 replicates. The
  drop in prime-betweenness R² at N ≥ 31623 tracks that switch, not N.
- The null preserves each edge's cost in its slot, so weighted degree on the
  prime side cannot change under rewiring. `degree_weighted` z-scores are a
  construction check, not evidence; they are stored but not used in any
  verdict.
- z-scores are reported alongside empirical p-values and relative deviations
  throughout, because on this graph a large z routinely accompanies a
  sub-0.1% effect.
- 480 of 1440 rows carry `null_degenerate = True`; all are `degree` and
  `degree_weighted`, i.e. the construction checks.

## What was not run

E2 (anchor swap), E4 (N-stability), E5 (Erdős–Kac baseline), E6 (separating
v_p(n) from v_p(n−a)), E7 (Bruhat–Tits comparison) were not run, per the
instruction to stop after E1 and E3 if they came back ARTIFACT. They did.

Two of them are partly answered already by what was computed here. E4: the
top-20 eigenvector nodes track the largest primorial below N, and 210's
composite-rank moves monotonically from 1 to 8566 over three decades of N
(`results/e1_eigen_focus.csv`), which is drift, not a stable functional form.
E5: the top-20 by eigenvector in the as-built configuration is the primes in
ascending order, matched to ~1% by a degree-preserving null — consistent with
the ranking being recoverable from the degree sequence alone, though the
regression on ω(n) and Σ1/p that E5 specifies was not fitted.
