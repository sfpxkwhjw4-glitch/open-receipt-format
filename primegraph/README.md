# primegraph — falsification harness for a prime-divisibility graph

A test rig for two claims about the graph on `{1..N}` with edges `n—p` iff `p | n`:
that the anchor node dominates betweenness, and that eigenvector centrality
surfaces `30, 210, 330`. The rig is built to break those claims, not to
confirm them.

This directory is self-contained and unrelated to the Open Receipt Format spec
that occupies the rest of the repository.

## Layout

```
primegraph/graph.py       graph builder (N, anchor, hub_edges, hub_cost, weighting)
primegraph/metrics.py     betweenness / eigenvector / degree / PageRank + rank correlations
primegraph/nulls.py       bipartite-aware degree-preserving rewiring, z-scores
primegraph/experiments/   one module per experiment, each writes CSV+parquet+figure
tests/                    graph construction and p-adic valuation tests
results/                  result tables, run logs and figures
report.md                 claim / result / verdict, failures first
```

## Construction

Nodes are the integers `1..N`, one node per integer — the prime `p` and the
integer `p` are the same node, as in the construction under test. Divisibility
edges join a prime to each of its strictly-larger multiples, so that part of
the graph is bipartite between `P = {primes ≤ N}` and `C = {1} ∪ {composites}`.
Optional hub edges join the anchor to every prime at `hub_cost`.

Edge costs are **distances**: `padic` = `1/(1+v_p(n))`, `uniform` = `1`,
`log` = `1/log p`. Betweenness uses cost; eigenvector and PageRank use
affinity `1/cost`, since those treat their weight argument as an adjacency
entry. Both readings are computed and reported (`eigenvector` vs
`eigenvector_costweight`) rather than assumed.

## Running

```
python -m pytest tests -q
python -m primegraph.experiments.e1_hub_ablation --Ns 1000 3162 10000 31623 100000 1000000
python -m primegraph.experiments.e3_config_null  --Ns 1000 10000 --samples 100
```

Every RNG is seeded. Betweenness is exact up to `--exact-max-n` (default
10⁴) and k-sampled above it with a standard error across replicates. In E3 the
real graph and every null sample share one fixed pivot set, so pivot noise
cannot masquerade as a real-vs-null difference.
