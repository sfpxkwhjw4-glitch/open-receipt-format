"""Shared plumbing for the experiment runners."""

from __future__ import annotations

import os
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import numpy as np
import pandas as pd

from ..graph import PrimeGraph, build_graph
from .. import metrics as M

RESULTS = Path(__file__).resolve().parents[2] / "results"
FIGURES = RESULTS / "figures"

# Betweenness sampling budget above the exact-computation cutoff.
SAMPLED_K = {31623: 400, 100000: 200, 316228: 100, 1000000: 60}
SAMPLED_REPLICATES = 5


def ensure_dirs() -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)


def write_table(df: pd.DataFrame, stem: str) -> None:
    ensure_dirs()
    df.to_csv(RESULTS / f"{stem}.csv", index=False)
    try:
        df.to_parquet(RESULTS / f"{stem}.parquet", index=False)
    except Exception as exc:  # pragma: no cover - parquet is a convenience
        print(f"  (parquet skipped for {stem}: {exc})")


def spectral_metrics(g: PrimeGraph) -> dict[str, np.ndarray]:
    """Everything that does not require shortest paths.

    ``eigenvector`` uses affinity (1/cost) because eigenvector centrality
    treats its weight as an adjacency entry. ``eigenvector_costweight`` feeds
    the raw cost in the same slot, reproducing what happens when a distance
    is passed to networkx's ``weight=`` argument by mistake; both are reported
    so the ranking claims can be checked against either reading.
    """
    return {
        "degree": g.degrees(weighted=False),
        "degree_weighted": g.degrees(weighted=True),
        "eigenvector": M.eigenvector_centrality(g, weight="affinity"),
        "eigenvector_costweight": M.eigenvector_centrality(g, weight="cost"),
        "pagerank": M.pagerank(g, weight="affinity"),
    }


def betweenness_for(g: PrimeGraph, exact_max_n: int, seed: int = 0):
    if g.N <= exact_max_n:
        return M.betweenness(g, weight="cost", exact_max_n=exact_max_n)
    k = SAMPLED_K.get(g.N, max(50, min(400, 2_000_000 // g.N)))
    return M.betweenness(
        g, weight="cost", k=k, replicates=SAMPLED_REPLICATES, seed=seed, exact_max_n=exact_max_n
    )


def node_frame(g: PrimeGraph, values: dict[str, np.ndarray]) -> pd.DataFrame:
    nodes = np.arange(1, g.N + 1)
    is_prime = g.is_prime_mask()
    df = pd.DataFrame({"node": nodes, "is_prime": is_prime})
    for name, v in values.items():
        df[name] = v
    return df


def top_rows(df: pd.DataFrame, metric: str, k: int = 10) -> pd.DataFrame:
    out = df.nlargest(k, metric)[["node", "is_prime", metric]].copy()
    out.insert(0, "rank", np.arange(1, len(out) + 1))
    out.insert(0, "metric", metric)
    return out


def n_workers() -> int:
    return max(1, min(4, (os.cpu_count() or 1)))
