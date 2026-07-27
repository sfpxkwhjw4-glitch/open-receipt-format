"""Parameterized builder for the prime-divisibility graph on {1..N}.

Node set is the integers 1..N, one node per integer (this matches the
construction under test: the prime p and the integer p are the same node).
Every divisibility edge joins a prime node to a strictly-larger multiple of
it, so the divisibility part of the graph is bipartite between

    P = {primes <= N}                and    C = {1} U {composites <= N}

Optional "hub" edges join a chosen anchor node ``a`` to every prime; when
``a`` is itself prime these are the only P--P edges in the graph.

Nothing here reads back the claims in the task description: costs, node
classes and valuations are all computed from scratch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator

import numpy as np
import scipy.sparse as sp

WEIGHTINGS = ("padic", "uniform", "log")


def smallest_prime_factor(n: int) -> np.ndarray:
    """spf[k] = smallest prime factor of k, for k in 0..n (spf[0]=spf[1]=0)."""
    if n < 1:
        raise ValueError("n must be >= 1")
    spf = np.zeros(n + 1, dtype=np.int64)
    for i in range(2, n + 1):
        if spf[i] == 0:
            spf[i::i] = np.where(spf[i::i] == 0, i, spf[i::i])
    return spf


def primes_upto(n: int) -> np.ndarray:
    """Primes <= n as an ascending int64 array (sieve of Eratosthenes)."""
    if n < 2:
        return np.zeros(0, dtype=np.int64)
    sieve = np.ones(n + 1, dtype=bool)
    sieve[:2] = False
    for i in range(2, int(n**0.5) + 1):
        if sieve[i]:
            sieve[i * i :: i] = False
    return np.flatnonzero(sieve).astype(np.int64)


def valuation(n: int, p: int) -> int:
    """p-adic valuation v_p(n): the exponent of p in n. v_p(0) is infinite,
    so it is rejected; v_p(n) for negative n uses |n|."""
    if p < 2:
        raise ValueError("p must be >= 2")
    if n == 0:
        raise ValueError("v_p(0) is undefined (infinite)")
    n = abs(int(n))
    v = 0
    while n % p == 0:
        n //= p
        v += 1
    return v


def omega(n: int, spf: np.ndarray | None = None) -> int:
    """Number of distinct prime factors of n (omega, not big-Omega)."""
    n = int(n)
    if n < 2:
        return 0
    count = 0
    d = 2
    while d * d <= n:
        if n % d == 0:
            count += 1
            while n % d == 0:
                n //= d
        d += 1
    if n > 1:
        count += 1
    return count


def _edge_costs(p: int, v: np.ndarray, weighting: str) -> np.ndarray:
    """Edge *cost* (a distance: smaller = closer) for edges out of prime p."""
    if weighting == "padic":
        return 1.0 / (1.0 + v.astype(np.float64))
    if weighting == "uniform":
        return np.ones(v.shape[0], dtype=np.float64)
    if weighting == "log":
        return np.full(v.shape[0], 1.0 / np.log(p), dtype=np.float64)
    raise ValueError(f"unknown weighting {weighting!r}; expected one of {WEIGHTINGS}")


@dataclass
class PrimeGraph:
    """Edge-array representation of the graph, plus node bookkeeping.

    Attributes
    ----------
    src, dst : int64 arrays
        ``src`` is always the prime endpoint of a divisibility edge. For hub
        edges ``src`` is the anchor and ``dst`` the prime.
    vp : int64 array
        v_p(n) for divisibility edges; 0 for hub edges (no valuation applies).
    cost : float64 array
        Edge cost (distance semantics: used as the weight for shortest paths).
    is_hub : bool array
        True for the hand-added anchor--prime edges.
    """

    N: int
    anchor: int
    hub_edges: bool
    hub_cost: float
    weighting: str
    src: np.ndarray
    dst: np.ndarray
    vp: np.ndarray
    cost: np.ndarray
    is_hub: np.ndarray
    primes: np.ndarray
    params: dict = field(default_factory=dict)

    # -- node bookkeeping ------------------------------------------------
    @property
    def n_nodes(self) -> int:
        return self.N

    @property
    def n_edges(self) -> int:
        return int(self.src.shape[0])

    def is_prime_mask(self) -> np.ndarray:
        """Boolean mask over node index 0..N-1 (node k is index k-1)."""
        mask = np.zeros(self.N, dtype=bool)
        mask[self.primes - 1] = True
        return mask

    @property
    def affinity(self) -> np.ndarray:
        """Affinity (similarity) weight = 1/cost.

        Costs are distances. Spectral metrics (eigenvector, PageRank) treat
        their weight argument as an adjacency entry, i.e. bigger = stronger,
        so feeding them ``cost`` inverts the intended meaning. Both are
        exposed so experiments can report the difference instead of guessing.
        """
        return 1.0 / self.cost

    # -- exports ---------------------------------------------------------
    def to_csr(self, weight: str = "affinity") -> sp.csr_matrix:
        """Symmetric sparse adjacency, indexed by node-1 (node k -> row k-1)."""
        if weight == "affinity":
            w = self.affinity
        elif weight == "cost":
            w = self.cost
        elif weight == "none":
            w = np.ones(self.n_edges, dtype=np.float64)
        else:
            raise ValueError(f"unknown weight {weight!r}")
        i = self.src - 1
        j = self.dst - 1
        rows = np.concatenate([i, j])
        cols = np.concatenate([j, i])
        vals = np.concatenate([w, w])
        A = sp.coo_matrix((vals, (rows, cols)), shape=(self.N, self.N)).tocsr()
        A.sum_duplicates()
        return A

    def to_networkx(self):
        import networkx as nx

        G = nx.Graph()
        G.add_nodes_from(range(1, self.N + 1))
        aff = self.affinity
        G.add_edges_from(
            (int(u), int(v), {"cost": float(c), "affinity": float(a), "vp": int(x), "hub": bool(h)})
            for u, v, c, a, x, h in zip(self.src, self.dst, self.cost, aff, self.vp, self.is_hub)
        )
        return G

    def degrees(self, weighted: bool = False) -> np.ndarray:
        """Degree of every node, indexed by node-1."""
        deg = np.zeros(self.N, dtype=np.float64)
        w = self.affinity if weighted else np.ones(self.n_edges)
        np.add.at(deg, self.src - 1, w)
        np.add.at(deg, self.dst - 1, w)
        return deg

    def label(self) -> str:
        return (
            f"N={self.N}_a={self.anchor}_hub={int(self.hub_edges)}"
            f"_hc={self.hub_cost:g}_w={self.weighting}"
        )


def build_graph(
    N: int,
    anchor: int = 2,
    hub_edges: bool = True,
    hub_cost: float = 0.1,
    weighting: str = "padic",
) -> PrimeGraph:
    """Build the divisibility graph on {1..N}.

    Divisibility edges: p -- n for every prime p <= N and every multiple
    n = 2p, 3p, ... <= N. Self-loops (n == p) are excluded.

    Hub edges: anchor -- p for every prime p <= N, at ``hub_cost``, skipping
    the self-loop and skipping any pair that already has a divisibility edge
    (in which case the cheaper of the two costs is kept, so turning hub edges
    on can only ever make the anchor better connected, never worse).
    """
    if N < 2:
        raise ValueError("N must be >= 2")
    if weighting not in WEIGHTINGS:
        raise ValueError(f"unknown weighting {weighting!r}; expected one of {WEIGHTINGS}")
    if anchor < 1 or anchor > N:
        raise ValueError(f"anchor {anchor} must lie in 1..{N}")

    primes = primes_upto(N)
    src_parts, dst_parts, vp_parts, cost_parts = [], [], [], []

    for p in primes.tolist():
        K = N // p
        if K < 2:
            continue  # p has no multiple <= N other than itself
        # k indexes the multiple n = k*p, for k = 2..K.
        vk = np.zeros(K, dtype=np.int64)  # vk[i] = v_p(k) for k = i+1
        pk = p
        while pk <= K:
            vk[pk - 1 :: pk] += 1
            pk *= p
        k = np.arange(2, K + 1, dtype=np.int64)
        v = 1 + vk[1:]  # v_p(n) = 1 + v_p(k)
        src_parts.append(np.full(K - 1, p, dtype=np.int64))
        dst_parts.append(k * p)
        vp_parts.append(v)
        cost_parts.append(_edge_costs(p, v, weighting))

    src = np.concatenate(src_parts) if src_parts else np.zeros(0, dtype=np.int64)
    dst = np.concatenate(dst_parts) if dst_parts else np.zeros(0, dtype=np.int64)
    vp = np.concatenate(vp_parts) if vp_parts else np.zeros(0, dtype=np.int64)
    cost = np.concatenate(cost_parts) if cost_parts else np.zeros(0, dtype=np.float64)
    is_hub = np.zeros(src.shape[0], dtype=bool)

    if hub_edges and primes.shape[0]:
        cand = primes[primes != anchor]
        # Drop pairs that already exist as divisibility edges: that is either
        # anchor | p (impossible for prime p unless anchor == p, already
        # dropped) or p | anchor.
        existing = cand[anchor % cand == 0]
        keep = cand[anchor % cand != 0]
        if existing.size:
            # The pair already has a divisibility edge (p | anchor). Keep one
            # edge and take the cheaper cost, matching "hand-added at low cost".
            sel = ((src == anchor) & np.isin(dst, existing)) | (
                (dst == anchor) & np.isin(src, existing)
            )
            cost[sel] = np.minimum(cost[sel], hub_cost)
        if keep.size:
            src = np.concatenate([src, np.full(keep.shape[0], anchor, dtype=np.int64)])
            dst = np.concatenate([dst, keep])
            vp = np.concatenate([vp, np.zeros(keep.shape[0], dtype=np.int64)])
            cost = np.concatenate([cost, np.full(keep.shape[0], float(hub_cost))])
            is_hub = np.concatenate([is_hub, np.ones(keep.shape[0], dtype=bool)])

    return PrimeGraph(
        N=N,
        anchor=anchor,
        hub_edges=hub_edges,
        hub_cost=float(hub_cost),
        weighting=weighting,
        src=src,
        dst=dst,
        vp=vp,
        cost=cost,
        is_hub=is_hub,
        primes=primes,
        params=dict(
            N=N, anchor=anchor, hub_edges=hub_edges, hub_cost=float(hub_cost), weighting=weighting
        ),
    )


def parameter_grid(
    Ns: list[int],
    anchors: list[int] = (2,),
    hub_options: list[bool] = (True, False),
    hub_costs: list[float] = (0.1,),
    weightings: list[str] = WEIGHTINGS,
) -> Iterator[dict]:
    for N in Ns:
        for a in anchors:
            for hub in hub_options:
                for hc in hub_costs if hub else (hub_costs[0],):
                    for w in weightings:
                        yield dict(N=N, anchor=a, hub_edges=hub, hub_cost=hc, weighting=w)


def log_spaced_Ns(lo: int = 1000, hi: int = 10**6, count: int = 4) -> list[int]:
    return [int(round(x)) for x in np.logspace(np.log10(lo), np.log10(hi), count)]
