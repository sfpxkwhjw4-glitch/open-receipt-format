"""E3 -- CONFIGURATION-MODEL NULL.

Claim under test: the centrality values of the top nodes say something about
arithmetic, beyond what is already fixed by the degree sequence.

The null is a bipartite-aware, degree-preserving rewiring: every node keeps
its exact degree, divisibility edges stay prime--non-prime, hub edges stay
anchor--prime, and the multiset of edge costs is preserved. What is destroyed
is *which* multiple of p a given edge points at -- i.e. all of the arithmetic.

Verdict condition, stated in advance: if |z| < 2 for the top nodes, the graph
encodes nothing beyond its 1/p degree sequence.

Betweenness for the real graph and for every null sample is estimated from
the *same* fixed pivot set, so the comparison is not contaminated by pivot
sampling noise.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from ..graph import build_graph
from .. import metrics as M
from ..nulls import configuration_null, z_scores
from .common import FIGURES, ensure_dirs, n_workers, spectral_metrics, write_table

DEFAULT_NS = [1000, 10000]
WEIGHTINGS = ["padic", "uniform", "log"]

# `degree` is a construction check, not a result: the null preserves degree
# exactly, so every z must come back 0. `degree_weighted` is likewise
# uninformative on the prime side, because each edge carries its cost with it
# through a swap and only the non-prime endpoint moves. Both are computed and
# stored, but neither is evidence for or against the claims.
METRICS = ["degree", "eigenvector", "eigenvector_costweight", "pagerank", "betweenness"]
CONSTRUCTION_CHECKS = {"degree", "degree_weighted"}


def _metrics_for(g, sources: np.ndarray | None) -> dict[str, np.ndarray]:
    vals = spectral_metrics(g)
    if sources is not None:
        vals["betweenness"] = M.betweenness(g, weight="cost", sources=sources).values
    return vals


def _null_sample(payload):
    cfg, seed, sources, swap_factor = payload
    g = build_graph(**cfg)
    rng = np.random.default_rng(seed)
    null = configuration_null(g, rng, swap_factor=swap_factor)
    vals = _metrics_for(null, sources)
    return {k: v for k, v in vals.items()}


def run_config(cfg: dict, n_samples: int, pivots: int, swap_factor: float,
               workers: int, top_k: int, seed: int, do_betweenness: bool) -> tuple[pd.DataFrame, dict]:
    g = build_graph(**cfg)
    rng = np.random.default_rng(seed)
    sources = None
    if do_betweenness:
        # Pivots are drawn once and reused for the real graph and every null.
        sources = rng.choice(np.arange(1, g.N + 1), size=min(pivots, g.N), replace=False)
    real = _metrics_for(g, sources)

    payloads = [(cfg, seed + 1000 + i, sources, swap_factor) for i in range(n_samples)]
    collected = {m: [] for m in real}
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for out in pool.map(_null_sample, payloads, chunksize=1):
            for m in collected:
                collected[m].append(out[m])

    rows = []
    for metric, obs in real.items():
        null_stack = np.vstack(collected[metric])
        z, p = z_scores(obs, null_stack)
        nodes = np.argsort(-obs)[:top_k] + 1
        for rank, node in enumerate(nodes, start=1):
            i = node - 1
            rows.append(
                dict(
                    **cfg,
                    metric=metric,
                    rank=rank,
                    node=int(node),
                    is_prime=bool(g.is_prime_mask()[i]),
                    observed=float(obs[i]),
                    null_mean=float(null_stack[:, i].mean()),
                    null_sd=float(null_stack[:, i].std(ddof=1)),
                    null_min=float(null_stack[:, i].min()),
                    null_max=float(null_stack[:, i].max()),
                    z=float(z[i]),
                    p_empirical=float(p[i]),
                    # z is unstable where the null is nearly constant; the
                    # empirical p-value is the honest companion statistic.
                    null_degenerate=bool(null_stack[:, i].std(ddof=1)
                                         <= 1e-12 * max(abs(obs[i]), 1e-12)),
                    n_null_samples=int(null_stack.shape[0]),
                    pivots=int(len(sources)) if sources is not None else None,
                )
            )
    df = pd.DataFrame(rows)

    summary = dict(cfg)
    summary["n_edges"] = g.n_edges
    summary["n_null_samples"] = n_samples
    for metric in real:
        sel = df[df.metric == metric]
        summary[f"max_abs_z_{metric}"] = float(sel["z"].abs().replace(np.inf, np.nan).max())
        summary[f"frac_top_abs_z_lt2_{metric}"] = float((sel["z"].abs() < 2).mean())
        summary[f"top1_node_{metric}"] = int(sel.iloc[0]["node"])
        summary[f"top1_z_{metric}"] = float(sel.iloc[0]["z"])
    return df, summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="E3 configuration-model null")
    ap.add_argument("--Ns", type=int, nargs="+", default=DEFAULT_NS)
    ap.add_argument("--anchor", type=int, default=2)
    ap.add_argument("--hub-cost", type=float, default=0.1)
    ap.add_argument("--weightings", nargs="+", default=WEIGHTINGS)
    ap.add_argument("--samples", type=int, default=100)
    ap.add_argument("--pivots", type=int, default=200)
    ap.add_argument("--swap-factor", type=float, default=10.0)
    ap.add_argument("--top-k", type=int, default=20)
    ap.add_argument("--seed", type=int, default=20260727)
    ap.add_argument("--betweenness-max-n", type=int, default=10000)
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--tag", default="")
    args = ap.parse_args(argv)

    ensure_dirs()
    workers = args.workers or n_workers()
    frames, summaries = [], []
    for N in args.Ns:
        for w in args.weightings:
            for hub in (True, False):
                cfg = dict(N=N, anchor=args.anchor, hub_edges=hub,
                           hub_cost=args.hub_cost, weighting=w)
                do_bet = N <= args.betweenness_max_n
                print(f"E3: {cfg} samples={args.samples} betweenness={do_bet}", flush=True)
                df, summary = run_config(
                    cfg, args.samples, args.pivots, args.swap_factor, workers,
                    args.top_k, args.seed, do_bet,
                )
                frames.append(df)
                summaries.append(summary)
                for metric in METRICS:
                    key = f"max_abs_z_{metric}"
                    if key in summary:
                        print(f"    {metric:<24} top1={summary[f'top1_node_{metric}']:>7} "
                              f"z(top1)={summary[f'top1_z_{metric}']:+9.2f} "
                              f"max|z|(top{args.top_k})={summary[key]:9.2f} "
                              f"frac|z|<2={summary[f'frac_top_abs_z_lt2_{metric}']:.2f}", flush=True)

    tag = f"_{args.tag}" if args.tag else ""
    detail = pd.concat(frames, ignore_index=True)
    write_table(detail, f"e3_config_null{tag}")
    write_table(pd.DataFrame(summaries), f"e3_config_null_summary{tag}")
    make_figure(detail, tag)
    print_verdict(detail)
    return 0


def make_figure(detail: pd.DataFrame, tag: str = "") -> None:
    metrics = [m for m in METRICS if m in set(detail.metric)]
    fig, axes = plt.subplots(1, len(metrics), figsize=(4.2 * len(metrics), 4.4), squeeze=False)
    for ax, metric in zip(axes[0], metrics):
        sel = detail[detail.metric == metric].replace([np.inf, -np.inf], np.nan).dropna(subset=["z"])
        for (N, hub), grp in sel.groupby(["N", "hub_edges"]):
            ax.scatter(grp["rank"], grp["z"], s=14, alpha=0.7,
                       marker="o" if hub else "x", label=f"N={N}, hub={int(hub)}")
        ax.axhspan(-2, 2, color="grey", alpha=0.18)
        ax.axhline(0, color="k", lw=0.6)
        ax.set_xlabel("rank in the real graph")
        ax.set_ylabel("z vs degree-preserving null")
        ax.set_title(metric, fontsize=10)
        ax.set_yscale("symlog", linthresh=2)
        ax.legend(fontsize=6)
    fig.suptitle("E3: real centrality vs bipartite degree-preserving null (grey band = |z| < 2)")
    fig.tight_layout()
    fig.savefig(FIGURES / f"e3_config_null{tag}.png", dpi=150)
    plt.close(fig)


def print_verdict(detail: pd.DataFrame) -> None:
    print("\n--- E3 summary ---")
    finite = detail.replace([np.inf, -np.inf], np.nan)
    for metric, grp in finite.groupby("metric"):
        frac = (grp["z"].abs() < 2).mean()
        tag = "  [construction check]" if metric in CONSTRUCTION_CHECKS else ""
        print(f"  {metric:<24} fraction of top nodes with |z| < 2: {frac:.2f} "
              f"(median |z| = {grp['z'].abs().median():.2f}, "
              f"max |z| = {grp['z'].abs().max():.2f}){tag}")
    check = finite[finite.metric == "degree"]
    if len(check) and check["z"].abs().max() > 1e-9:
        print("  WARNING: degree z != 0 -- the null is not degree-preserving.")


if __name__ == "__main__":
    raise SystemExit(main())
