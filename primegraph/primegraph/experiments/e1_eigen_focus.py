"""E1b -- hub ablation for the reported eigenvector nodes (30, 210, 330).

Same ablation as E1, applied to the second headline result. Spectral metrics
only, so this runs over the whole N sweep including 10^6.

Two things are reported that the raw top-10 list hides:

  * the graph's global eigenvector top is a small prime, not a composite, so
    "eigenvector surfaces 30/210/330" is a statement about the top *composite*
    nodes; the composite-only ranking is reported separately;
  * whether the hub edges change that composite ranking at all.
"""

from __future__ import annotations

import argparse

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import kendalltau

from ..graph import build_graph, primes_upto
from .. import metrics as M
from .common import FIGURES, ensure_dirs, write_table

CLAIMED = [30, 210, 330]
DEFAULT_NS = [1000, 3162, 10000, 31623, 100000, 1000000]


def primorials(limit: int) -> list[int]:
    out, acc = [], 1
    for p in primes_upto(200).tolist():
        acc *= p
        if acc > limit:
            break
        out.append(acc)
    return out


def run(N: int, weighting: str, hub: bool, hub_cost: float, anchor: int) -> tuple[dict, np.ndarray, np.ndarray]:
    g = build_graph(N=N, anchor=anchor, hub_edges=hub, hub_cost=hub_cost, weighting=weighting)
    ev = M.eigenvector_centrality(g, weight="affinity")
    evc = M.eigenvector_centrality(g, weight="cost")
    is_prime = g.is_prime_mask()
    rec = dict(N=N, weighting=weighting, hub_edges=hub, hub_cost=hub_cost, anchor=anchor)
    for name, v in (("eigenvector", ev), ("eigenvector_costweight", evc)):
        comp = v.copy()
        comp[is_prime] = -np.inf  # composites and 1 only
        order = np.argsort(-comp)
        rec[f"top10_composite_{name}"] = ",".join(str(int(x) + 1) for x in order[:10])
        rec[f"top1_overall_{name}"] = int(np.argmax(v) + 1)
        rec[f"top1_overall_is_prime_{name}"] = bool(is_prime[np.argmax(v)])
        comp_rank = np.empty(g.N, dtype=np.int64)
        comp_rank[order] = np.arange(1, g.N + 1)
        for c in CLAIMED:
            if c <= N:
                rec[f"comp_rank_{c}_{name}"] = int(comp_rank[c - 1])
                rec[f"overall_rank_{c}_{name}"] = int(M.rank_of(v, c))
    return rec, ev, evc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="E1b eigenvector hub ablation")
    ap.add_argument("--Ns", type=int, nargs="+", default=DEFAULT_NS)
    ap.add_argument("--anchor", type=int, default=2)
    ap.add_argument("--hub-cost", type=float, default=0.1)
    ap.add_argument("--weightings", nargs="+", default=["padic", "uniform", "log"])
    args = ap.parse_args(argv)

    ensure_dirs()
    rows = []
    vectors: dict[tuple, np.ndarray] = {}
    for N in args.Ns:
        for w in args.weightings:
            for hub in (True, False):
                rec, ev, evc = run(N, w, hub, args.hub_cost, args.anchor)
                rows.append(rec)
                vectors[(N, w, hub)] = ev
                print(f"  N={N:>7} w={w:<7} hub={int(hub)} "
                      f"top1={rec['top1_overall_eigenvector']:>7} "
                      f"top composites={rec['top10_composite_eigenvector'][:44]}", flush=True)

    # Does removing the hub edges reorder anything? Kendall tau between the
    # hub-on and hub-off eigenvector vectors, over the whole node set.
    for N in args.Ns:
        for w in args.weightings:
            a, b = vectors.get((N, w, True)), vectors.get((N, w, False))
            if a is None or b is None:
                continue
            n = min(len(a), 20000)  # tau is O(n log n); subsample for the big N
            idx = np.random.default_rng(0).choice(len(a), size=n, replace=False)
            tau = kendalltau(a[idx], b[idx], variant="b")
            for row in rows:
                if row["N"] == N and row["weighting"] == w:
                    row["tau_eig_hub_on_vs_off"] = float(tau.statistic)

    df = pd.DataFrame(rows)
    write_table(df, "e1_eigen_focus")
    make_figure(df)
    print("\n--- E1b summary ---")
    print(f"primorials <= 10^6: {primorials(10**6)}")
    for name in ("eigenvector", "eigenvector_costweight"):
        col = f"top1_overall_is_prime_{name}"
        print(f"{name}: global top node is prime in {int(df[col].sum())}/{len(df)} configurations")
    if "tau_eig_hub_on_vs_off" in df:
        print(f"median Kendall tau(eigenvector | hub on, hub off): "
              f"{df['tau_eig_hub_on_vs_off'].median():.3f}")
    return 0


def make_figure(df: pd.DataFrame) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.4))
    ax = axes[0]
    for c in CLAIMED:
        col = f"comp_rank_{c}_eigenvector"
        if col not in df:
            continue
        for (w, hub), grp in df.groupby(["weighting", "hub_edges"]):
            grp = grp.sort_values("N")
            ax.plot(grp["N"], grp[col], marker="o", ms=3,
                    ls="-" if hub else "--", label=f"{c}, {w}, hub={int(hub)}")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("N")
    ax.set_ylabel("rank among composite nodes (1 = top)")
    ax.set_title("E1b: rank of 30 / 210 / 330 in eigenvector centrality")
    ax.legend(fontsize=5, ncol=2)

    ax = axes[1]
    if "tau_eig_hub_on_vs_off" in df:
        for w, grp in df.groupby("weighting"):
            grp = grp.drop_duplicates("N").sort_values("N")
            ax.plot(grp["N"], grp["tau_eig_hub_on_vs_off"], marker="s", label=w)
    ax.axhline(1.0, color="k", lw=0.6, ls=":")
    ax.set_xscale("log")
    ax.set_xlabel("N")
    ax.set_ylabel(r"Kendall $\tau$ (hub on vs hub off)")
    ax.set_title("Does the hub ablation reorder eigenvector centrality?")
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(FIGURES / "e1_eigen_focus.png", dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    raise SystemExit(main())
