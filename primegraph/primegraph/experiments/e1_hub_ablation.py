"""E1 -- HUB ABLATION.

Claim under test: the anchor's dominance in betweenness is produced by the
hand-added anchor--prime edges.

Falsification hypothesis (the one that would make the dominance uninteresting
rather than wrong): the anchor tops betweenness because it has by far the most
neighbours -- |multiples of p| = floor(N/p) - 1 -- so any node sitting at the
p=2 end of the 1/p degree profile would do the same, with or without the
hand-added edges.

The experiment therefore reports, for hub_edges in {True, False}:
  * the anchor's betweenness score and rank,
  * whether prime betweenness is ordered by 1/p,
  * how much of log-betweenness across primes is explained by log(N/p) alone.
"""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ProcessPoolExecutor

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import kendalltau, linregress

from ..graph import build_graph
from .. import metrics as M
from .common import (
    FIGURES,
    RESULTS,
    betweenness_for,
    ensure_dirs,
    n_workers,
    node_frame,
    spectral_metrics,
    top_rows,
    write_table,
)

DEFAULT_NS = [1000, 3162, 10000, 31623, 100000]
WEIGHTINGS = ["padic", "uniform", "log"]


def run_one(cfg: dict) -> dict:
    exact_max_n = cfg.pop("exact_max_n")
    do_betweenness = cfg.pop("betweenness", True)
    sampled_k = cfg.pop("sampled_k", None)
    replicates = cfg.pop("replicates", None)
    g = build_graph(**cfg)
    vals = spectral_metrics(g)

    bt = None
    if do_betweenness:
        bt = betweenness_for(
            g, exact_max_n=exact_max_n, k=sampled_k, replicates=replicates
        )
        vals["betweenness"] = bt.values

    df = node_frame(g, vals)
    df["p_index"] = np.nan
    df.loc[df.is_prime, "p_index"] = 1.0 / df.loc[df.is_prime, "node"]

    anchor = cfg["anchor"]
    rec = dict(cfg)
    rec["n_edges"] = g.n_edges
    rec["exact_betweenness"] = bool(bt.exact) if bt else False
    rec["betweenness_k"] = bt.k if bt else None

    for metric in vals:
        rec[f"anchor_{metric}"] = float(df.loc[df.node == anchor, metric].iloc[0])
        rec[f"anchor_rank_{metric}"] = int(M.rank_of(vals[metric], anchor))
        rec[f"top1_{metric}"] = int(df.loc[df[metric].idxmax(), "node"])
        rec[f"top10_{metric}"] = ",".join(
            str(int(x)) for x in df.nlargest(10, metric)["node"].tolist()
        )

    if bt is not None and bt.stderr is not None:
        se = bt.stderr[anchor - 1]
        rec["anchor_betweenness_se"] = float(se)
        rec["anchor_betweenness_ci95_lo"] = float(bt.values[anchor - 1] - 1.96 * se)
        rec["anchor_betweenness_ci95_hi"] = float(bt.values[anchor - 1] + 1.96 * se)

    # -- is prime centrality just the 1/p degree profile? -----------------
    pr = df[df.is_prime & (df.degree > 0)].copy()
    if do_betweenness and len(pr) > 3:
        tau = kendalltau(pr["betweenness"], pr["p_index"], variant="b")
        rec["tau_betweenness_vs_inv_p"] = float(tau.statistic)
        rec["tau_betweenness_vs_inv_p_p"] = float(tau.pvalue)
        pos = pr[pr["betweenness"] > 0]
        if len(pos) > 3:
            fit = linregress(np.log(pos["degree"]), np.log(pos["betweenness"]))
            rec["loglog_bet_vs_degree_r2"] = float(fit.rvalue**2)
            rec["loglog_bet_vs_degree_slope"] = float(fit.slope)
        tau_d = kendalltau(pr["betweenness"], pr["degree"], variant="b")
        rec["tau_betweenness_vs_degree"] = float(tau_d.statistic)

    metric_names = [m for m in vals]
    rec["rank_correlations"] = json.dumps(
        M.rank_correlations({m: vals[m] for m in metric_names})
    )

    node_rows = df.nlargest(30, "eigenvector")["node"].tolist()
    if do_betweenness:
        node_rows += df.nlargest(30, "betweenness")["node"].tolist()
    node_rows = sorted(set(node_rows + [anchor]))
    detail = df[df.node.isin(node_rows)].copy()
    for key, value in cfg.items():
        detail[key] = value
    rec["_detail"] = detail
    return rec


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="E1 hub ablation")
    ap.add_argument("--Ns", type=int, nargs="+", default=DEFAULT_NS)
    ap.add_argument("--anchor", type=int, default=2)
    ap.add_argument("--hub-cost", type=float, default=0.1)
    ap.add_argument("--weightings", nargs="+", default=WEIGHTINGS)
    ap.add_argument("--exact-max-n", type=int, default=10000)
    ap.add_argument("--spectral-only-above", type=int, default=100000,
                    help="skip betweenness above this N (it is the cost driver)")
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--sampled-k", type=int, default=None,
                    help="pivot count above --exact-max-n (default: per-N table)")
    ap.add_argument("--replicates", type=int, default=None,
                    help="independent pivot samples, used for the betweenness CI")
    args = ap.parse_args(argv)

    ensure_dirs()
    configs = []
    for N in args.Ns:
        for w in args.weightings:
            for hub in (True, False):
                configs.append(
                    dict(
                        N=N,
                        anchor=args.anchor,
                        hub_edges=hub,
                        hub_cost=args.hub_cost,
                        weighting=w,
                        exact_max_n=args.exact_max_n,
                        betweenness=N <= args.spectral_only_above,
                        sampled_k=args.sampled_k,
                        replicates=args.replicates,
                    )
                )

    workers = args.workers or n_workers()
    print(f"E1: {len(configs)} configurations on {workers} workers")
    results = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for rec in pool.map(run_one, configs):
            results.append(rec)
            print(
                f"  N={rec['N']:>7} w={rec['weighting']:<7} hub={int(rec['hub_edges'])} "
                f"anchor_bet_rank={rec.get('anchor_rank_betweenness')} "
                f"top1_bet={rec.get('top1_betweenness')} "
                f"top1_eig={rec.get('top1_eigenvector')}"
            )

    details = pd.concat([r.pop("_detail") for r in results], ignore_index=True)
    summary = pd.DataFrame(results).sort_values(["N", "weighting", "hub_edges"])
    write_table(summary, "e1_hub_ablation")
    write_table(details, "e1_hub_ablation_nodes")
    make_figure(summary)
    print_verdict(summary)
    return 0


def make_figure(summary: pd.DataFrame) -> None:
    sub = summary[summary["anchor_rank_betweenness"].notna()]
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.4))

    ax = axes[0]
    for (w, hub), grp in sub.groupby(["weighting", "hub_edges"]):
        grp = grp.sort_values("N")
        ax.plot(grp["N"], grp["anchor_betweenness"], marker="o",
                ls="-" if hub else "--", label=f"{w}, hub={int(hub)}")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("N")
    ax.set_ylabel("betweenness of anchor")
    ax.set_title("E1: anchor betweenness, hub on (solid) / off (dashed)")
    ax.legend(fontsize=7)

    ax = axes[1]
    for (w, hub), grp in sub.groupby(["weighting", "hub_edges"]):
        grp = grp.sort_values("N")
        ax.plot(grp["N"], grp["anchor_rank_betweenness"], marker="s",
                ls="-" if hub else "--", label=f"{w}, hub={int(hub)}")
    ax.set_xscale("log")
    ax.set_xlabel("N")
    ax.set_ylabel("rank of anchor (1 = top)")
    ax.set_ylim(0.5, max(3.0, float(sub["anchor_rank_betweenness"].max()) + 0.5))
    ax.set_title("Anchor rank in betweenness")
    ax.legend(fontsize=7)

    ax = axes[2]
    col = "loglog_bet_vs_degree_r2"
    if col in sub:
        for (w, hub), grp in sub.groupby(["weighting", "hub_edges"]):
            grp = grp.sort_values("N")
            ax.plot(grp["N"], grp[col], marker="^",
                    ls="-" if hub else "--", label=f"{w}, hub={int(hub)}")
    ax.set_xscale("log")
    ax.set_ylim(0, 1.02)
    ax.set_xlabel("N")
    ax.set_ylabel(r"$R^2$ of log(betweenness) ~ log(degree), primes")
    ax.set_title("Is prime betweenness just the 1/p degree profile?")
    ax.legend(fontsize=7)

    fig.tight_layout()
    fig.savefig(FIGURES / "e1_hub_ablation.png", dpi=150)
    plt.close(fig)


def print_verdict(summary: pd.DataFrame) -> None:
    sub = summary[summary["anchor_rank_betweenness"].notna()]
    off = sub[~sub["hub_edges"]]
    on = sub[sub["hub_edges"]]
    print("\n--- E1 summary ---")
    print(f"anchor is betweenness rank 1 with hub edges:    {(on['anchor_rank_betweenness'] == 1).sum()}/{len(on)}")
    print(f"anchor is betweenness rank 1 without hub edges: {(off['anchor_rank_betweenness'] == 1).sum()}/{len(off)}")
    if "loglog_bet_vs_degree_r2" in sub:
        print(f"median R^2 of log-betweenness ~ log-degree over primes: "
              f"{sub['loglog_bet_vs_degree_r2'].median():.3f}")
    if "tau_betweenness_vs_inv_p" in sub:
        print(f"median Kendall tau(betweenness, 1/p) over primes: "
              f"{sub['tau_betweenness_vs_inv_p'].median():.3f}")


if __name__ == "__main__":
    raise SystemExit(main())
