"""Centrality metrics with explicit weight semantics.

Weight semantics matter here and are easy to get backwards:

* Betweenness needs a *distance*  -> uses ``cost``.
* Eigenvector / PageRank need an *affinity* -> uses ``1/cost``.

Every function takes a ``PrimeGraph`` and returns a float64 array indexed by
node-1 (node k lives at index k-1), so metrics compose with numpy directly.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from scipy.stats import kendalltau, spearmanr

from .graph import PrimeGraph

EXACT_BETWEENNESS_MAX_N = 10_000


def degree_centrality(g: PrimeGraph, weighted: bool = False) -> np.ndarray:
    return g.degrees(weighted=weighted)


def eigenvector_centrality(
    g: PrimeGraph, weight: str = "affinity", tol: float = 1e-10, maxiter: int = 5000
) -> np.ndarray:
    """Principal eigenvector of the (symmetric, non-negative) adjacency.

    Uses ``eigsh`` rather than networkx power iteration: the graph is
    disconnected (node 1 is isolated, and every prime p > N/2 is isolated
    without hub edges), which networkx's implementation handles poorly.
    Support concentrates on the leading component; isolated nodes get 0.
    """
    A = g.to_csr(weight=weight)
    if A.nnz == 0:
        return np.zeros(g.N)
    k = 1
    try:
        vals, vecs = spla.eigsh(A, k=k, which="LA", tol=tol, maxiter=maxiter)
        v = np.asarray(vecs[:, 0], dtype=np.float64)
    except spla.ArpackNoConvergence as exc:  # pragma: no cover - fallback path
        if exc.eigenvectors is not None and exc.eigenvectors.shape[1]:
            v = np.asarray(exc.eigenvectors[:, 0], dtype=np.float64)
        else:
            raise
    if v.sum() < 0:
        v = -v
    v = np.clip(v, 0.0, None)
    norm = np.linalg.norm(v)
    return v / norm if norm > 0 else v


def pagerank(g: PrimeGraph, weight: str = "affinity", alpha: float = 0.85,
             tol: float = 1e-12, maxiter: int = 2000) -> np.ndarray:
    """Power-iteration PageRank on the symmetric affinity matrix."""
    A = g.to_csr(weight=weight)
    n = g.N
    out = np.asarray(A.sum(axis=1)).ravel()
    dangling = out == 0
    inv = np.where(dangling, 0.0, 1.0 / np.where(dangling, 1.0, out))
    D = sp.diags(inv)
    M = (D @ A).T.tocsr()
    x = np.full(n, 1.0 / n)
    teleport = np.full(n, (1.0 - alpha) / n)
    for _ in range(maxiter):
        dangle_mass = alpha * x[dangling].sum() / n
        x_new = alpha * (M @ x) + teleport + dangle_mass
        if np.abs(x_new - x).sum() < tol * n:
            x = x_new
            break
        x = x_new
    return x / x.sum()


@dataclass
class BetweennessResult:
    values: np.ndarray  # indexed by node-1
    stderr: np.ndarray | None  # per-node standard error across replicates
    exact: bool
    k: int | None
    replicates: int

    def ci95(self) -> np.ndarray | None:
        if self.stderr is None:
            return None
        return 1.96 * self.stderr


def betweenness(
    g: PrimeGraph,
    weight: str = "cost",
    seed: int = 0,
    k: int | None = None,
    replicates: int = 5,
    exact_max_n: int = EXACT_BETWEENNESS_MAX_N,
    sources: np.ndarray | None = None,
) -> BetweennessResult:
    """Betweenness centrality, exact for small N and k-sampled above.

    ``sources`` pins the pivot set explicitly, which is what makes real-vs-null
    comparisons valid: both must be estimated from the same pivots or the
    sampling noise shows up as a spurious difference.
    """
    import networkx as nx

    G = g.to_networkx()
    wkey = weight if weight in ("cost", "affinity") else None

    if sources is not None:
        vals = _betweenness_from_sources(G, np.asarray(sources), wkey, g.N)
        return BetweennessResult(vals, None, False, int(len(sources)), 1)

    if g.N <= exact_max_n and k is None:
        bc = nx.betweenness_centrality(G, weight=wkey, normalized=True)
        vals = np.zeros(g.N)
        for node, val in bc.items():
            vals[node - 1] = val
        return BetweennessResult(vals, None, True, None, 1)

    k = k or min(g.N, max(200, int(2000)))
    reps = []
    for r in range(replicates):
        bc = nx.betweenness_centrality(G, k=k, weight=wkey, normalized=True, seed=seed + r)
        vals = np.zeros(g.N)
        for node, val in bc.items():
            vals[node - 1] = val
        reps.append(vals)
    stack = np.vstack(reps)
    mean = stack.mean(axis=0)
    stderr = stack.std(axis=0, ddof=1) / np.sqrt(replicates) if replicates > 1 else None
    return BetweennessResult(mean, stderr, False, k, replicates)


def _betweenness_from_sources(G, sources: np.ndarray, wkey, n: int) -> np.ndarray:
    """Brandes' algorithm restricted to a fixed pivot set (weighted or not)."""
    import networkx as nx
    from networkx.algorithms.centrality.betweenness import (
        _single_source_dijkstra_path_basic,
        _single_source_shortest_path_basic,
        _accumulate_basic,
    )

    betweenness_map = dict.fromkeys(G, 0.0)
    for s in sources.tolist():
        s = int(s)
        if s not in G:
            continue
        if wkey is None:
            S, P, sigma, _ = _single_source_shortest_path_basic(G, s)
        else:
            S, P, sigma, _ = _single_source_dijkstra_path_basic(G, s, wkey)
        betweenness_map, _ = _accumulate_basic(betweenness_map, S, P, sigma, s)
    vals = np.zeros(n)
    # Same rescaling networkx applies for k-sampled, undirected, normalized.
    N = G.number_of_nodes()
    scale = 1.0 / (len(sources) * (N - 2)) if N > 2 else None
    for node, val in betweenness_map.items():
        vals[node - 1] = val * scale if scale else val
    return vals


# -- rank comparison ------------------------------------------------------


def rank_correlations(metrics: dict[str, np.ndarray], mask: np.ndarray | None = None) -> list[dict]:
    """Pairwise Kendall tau-b and Spearman rho between metric vectors."""
    names = sorted(metrics)
    rows = []
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            x, y = metrics[a], metrics[b]
            if mask is not None:
                x, y = x[mask], y[mask]
            tau = kendalltau(x, y, variant="b")
            rho = spearmanr(x, y)
            rows.append(
                dict(
                    metric_a=a,
                    metric_b=b,
                    kendall_tau=float(tau.statistic),
                    kendall_p=float(tau.pvalue),
                    spearman_rho=float(rho.statistic),
                    n=int(len(x)),
                )
            )
    return rows


def top_k(values: np.ndarray, k: int = 20) -> np.ndarray:
    """Node labels (1-based) of the k largest values, descending."""
    idx = np.argpartition(-values, min(k, len(values) - 1))[:k]
    idx = idx[np.argsort(-values[idx])]
    return idx + 1


def rank_of(values: np.ndarray, node: int) -> int:
    """1-based rank of ``node`` (competition ranking: ties share the best rank)."""
    v = values[node - 1]
    return int((values > v).sum() + 1)
