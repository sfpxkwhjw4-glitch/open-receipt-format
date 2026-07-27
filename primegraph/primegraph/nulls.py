"""Degree-preserving null models for the divisibility graph.

The graph has two edge classes:

  * divisibility edges, always prime -- non-prime  (bipartite P--C)
  * hub edges, anchor -- prime                     (P--P when anchor is prime)

Rewiring happens *within* each class, so every node keeps its exact degree
and no prime ever acquires a "multiple" that is itself prime. That is the
bipartite-aware requirement: a null that ignored it would destroy the class
structure and make the comparison meaningless.

Swaps are the standard double-edge swap (u-v, x-y -> u-y, x-v), applied in
vectorized batches with rejection of self-loops and multi-edges, so the
stationary distribution is the uniform distribution over simple graphs with
the given degree sequence and edge classes.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from .graph import PrimeGraph


def _pair_keys(a: np.ndarray, b: np.ndarray, N: int) -> np.ndarray:
    lo = np.minimum(a, b)
    hi = np.maximum(a, b)
    return lo * (N + 1) + hi


def _rewire_class(
    src: np.ndarray,
    dst: np.ndarray,
    N: int,
    rng: np.random.Generator,
    swap_factor: float = 10.0,
    batch: int = 4096,
) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Double-edge-swap randomize one edge class, preserving both endpoints'
    degrees. ``src``/``dst`` keep their side: only the dst endpoints are
    exchanged, so a bipartite class stays bipartite.

    Returns (src, dst, attempts, accepted).
    """
    m = src.shape[0]
    if m < 2:
        return src.copy(), dst.copy(), 0, 0
    src = src.copy()
    dst = dst.copy()
    keys = set(_pair_keys(src, dst, N).tolist())
    target = int(swap_factor * m)
    attempts = 0
    accepted = 0
    stride = N + 1
    src_list = src.tolist()
    dst_list = dst.tolist()
    while attempts < target:
        n = min(batch, target - attempts)
        ii = rng.integers(0, m, size=n).tolist()
        jj = rng.integers(0, m, size=n).tolist()
        attempts += n
        # Propose swapping the dst endpoints of edges i and j. Applied one at
        # a time against the live key set, so two proposals inside the same
        # batch can never collude to create a duplicate edge.
        for i, j in zip(ii, jj):
            if i == j:
                continue
            ui, vi = src_list[i], dst_list[i]
            uj, vj = src_list[j], dst_list[j]
            if ui == uj or vi == vj or ui == vj or uj == vi:
                continue
            a1, b1 = (ui, vj) if ui < vj else (vj, ui)
            a2, b2 = (uj, vi) if uj < vi else (vi, uj)
            ka = a1 * stride + b1
            kb = a2 * stride + b2
            if ka == kb or ka in keys or kb in keys:
                continue
            o1, p1 = (ui, vi) if ui < vi else (vi, ui)
            o2, p2 = (uj, vj) if uj < vj else (vj, uj)
            keys.discard(o1 * stride + p1)
            keys.discard(o2 * stride + p2)
            keys.add(ka)
            keys.add(kb)
            dst_list[i] = vj
            dst_list[j] = vi
            accepted += 1
    return src, np.asarray(dst_list, dtype=np.int64), attempts, accepted


def configuration_null(
    g: PrimeGraph, rng: np.random.Generator, swap_factor: float = 10.0
) -> PrimeGraph:
    """One degree-preserving, class-preserving rewiring of ``g``.

    Edge attributes (cost, vp) travel with their edge slot: the *multiset* of
    edge costs is preserved exactly, only the topology is randomized. This
    isolates "does the wiring carry information" from "do the weights".
    """
    src = g.src.copy()
    dst = g.dst.copy()
    attempts = accepted = 0
    for mask in (~g.is_hub, g.is_hub):
        if not mask.any():
            continue
        s, d, a, acc = _rewire_class(src[mask], dst[mask], g.N, rng, swap_factor=swap_factor)
        src[mask] = s
        dst[mask] = d
        attempts += a
        accepted += acc
    out = replace(g, src=src, dst=dst)
    out.params = dict(g.params, null="configuration", swaps_accepted=accepted, swaps_attempted=attempts)
    return out


def z_scores(observed: np.ndarray, null_samples: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(z, empirical two-sided p) of ``observed`` against null rows.

    ``null_samples`` is (n_samples, n_nodes). Nodes with zero null variance
    get z = 0 when the observed value matches the constant and +/-inf
    otherwise; those are reported as-is rather than silently dropped.
    """
    mu = null_samples.mean(axis=0)
    sd = null_samples.std(axis=0, ddof=1)
    z = np.zeros_like(mu, dtype=np.float64)
    good = sd > 0
    z[good] = (observed[good] - mu[good]) / sd[good]
    degenerate = (~good) & (observed != mu)
    z[degenerate] = np.inf * np.sign(observed[degenerate] - mu[degenerate])
    n = null_samples.shape[0]
    ge = (null_samples >= observed[None, :]).sum(axis=0)
    le = (null_samples <= observed[None, :]).sum(axis=0)
    p = 2.0 * np.minimum(ge, le) / n
    return z, np.minimum(p, 1.0)
