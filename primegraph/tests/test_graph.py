"""Tests for graph construction and p-adic valuation."""

import numpy as np
import pytest
from sympy import factorint, isprime, primerange

from primegraph.graph import (
    build_graph,
    omega,
    primes_upto,
    smallest_prime_factor,
    valuation,
)
from primegraph.nulls import configuration_null


# -- valuation -----------------------------------------------------------


@pytest.mark.parametrize(
    "n,p,expected",
    [(1, 2, 0), (2, 2, 1), (4, 2, 2), (8, 2, 3), (12, 2, 2), (12, 3, 1), (7, 2, 0),
     (3**7, 3, 7), (2 * 3**5 * 5, 3, 5), (1024, 2, 10)],
)
def test_valuation_known_values(n, p, expected):
    assert valuation(n, p) == expected


def test_valuation_matches_sympy():
    for n in range(1, 500):
        f = factorint(n)
        for p in (2, 3, 5, 7, 11):
            assert valuation(n, p) == f.get(p, 0)


def test_valuation_rejects_zero_and_bad_prime():
    with pytest.raises(ValueError):
        valuation(0, 2)
    with pytest.raises(ValueError):
        valuation(10, 1)


def test_valuation_is_multiplicative():
    for a in range(1, 60):
        for b in range(1, 60):
            for p in (2, 3, 5):
                assert valuation(a * b, p) == valuation(a, p) + valuation(b, p)


# -- sieves --------------------------------------------------------------


def test_primes_upto_matches_sympy():
    for n in (1, 2, 10, 100, 1000):
        assert primes_upto(n).tolist() == list(primerange(2, n + 1))


def test_smallest_prime_factor():
    spf = smallest_prime_factor(200)
    for n in range(2, 201):
        assert spf[n] == min(factorint(n))


def test_omega_matches_sympy():
    for n in range(1, 300):
        assert omega(n) == len(factorint(n))


# -- graph construction --------------------------------------------------


def test_edges_are_exactly_divisibility_pairs():
    g = build_graph(60, hub_edges=False)
    edges = {(int(u), int(v)) for u, v in zip(g.src, g.dst)}
    expected = {
        (p, n)
        for p in primes_upto(60).tolist()
        for n in range(2 * p, 61, p)
    }
    assert edges == expected


def test_no_self_loops_and_src_is_always_prime():
    g = build_graph(200, hub_edges=False)
    assert (g.src != g.dst).all()
    assert set(g.src.tolist()) <= set(primes_upto(200).tolist())


def test_divisibility_part_is_bipartite_prime_vs_nonprime():
    g = build_graph(300, hub_edges=False)
    for u, v in zip(g.src.tolist(), g.dst.tolist()):
        assert isprime(u)
        assert not isprime(v)


def test_edge_vp_matches_valuation():
    g = build_graph(400, hub_edges=False)
    rng = np.random.default_rng(0)
    idx = rng.choice(g.n_edges, size=200, replace=False)
    for i in idx:
        p, n, v = int(g.src[i]), int(g.dst[i]), int(g.vp[i])
        assert v == valuation(n, p)
        assert v >= 1


def test_edge_count_matches_closed_form():
    N = 5000
    g = build_graph(N, hub_edges=False)
    expected = sum(N // p - 1 for p in primes_upto(N).tolist())
    assert g.n_edges == expected


def test_padic_costs():
    g = build_graph(100, hub_edges=False, weighting="padic")
    np.testing.assert_allclose(g.cost, 1.0 / (1.0 + g.vp))


def test_uniform_and_log_costs():
    g = build_graph(100, hub_edges=False, weighting="uniform")
    np.testing.assert_allclose(g.cost, 1.0)
    g = build_graph(100, hub_edges=False, weighting="log")
    np.testing.assert_allclose(g.cost, 1.0 / np.log(g.src.astype(float)))


def test_hub_edges_added_for_every_other_prime():
    N = 200
    g = build_graph(N, anchor=2, hub_edges=True, hub_cost=0.1)
    hub = {(int(u), int(v)) for u, v, h in zip(g.src, g.dst, g.is_hub) if h}
    expected = {(2, p) for p in primes_upto(N).tolist() if p != 2}
    assert hub == expected
    assert (g.cost[g.is_hub] == 0.1).all()


def test_hub_edges_off_means_no_hub_edges():
    g = build_graph(200, hub_edges=False)
    assert not g.is_hub.any()


def test_hub_edges_never_duplicate_an_existing_edge():
    # anchor 6 is composite: 2|6 and 3|6, so those pairs already exist.
    N = 100
    g = build_graph(N, anchor=6, hub_edges=True, hub_cost=0.05)
    keys = [tuple(sorted((int(u), int(v)))) for u, v in zip(g.src, g.dst)]
    assert len(keys) == len(set(keys))
    # the pre-existing 2--6 edge got the cheaper hub cost
    i = keys.index((2, 6))
    assert g.cost[i] == 0.05


def test_composite_anchor_keeps_graph_bipartite():
    g = build_graph(200, anchor=9, hub_edges=True)
    for u, v, h in zip(g.src.tolist(), g.dst.tolist(), g.is_hub.tolist()):
        if h:
            assert u == 9 and isprime(v)


def test_anchor_accepts_any_integer():
    for a in (1, 2, 3, 4, 101, 200):
        g = build_graph(200, anchor=a, hub_edges=True)
        assert g.anchor == a
    with pytest.raises(ValueError):
        build_graph(200, anchor=201)


def test_degrees_match_divisor_counts():
    N = 500
    g = build_graph(N, hub_edges=False)
    deg = g.degrees()
    # a prime p is joined to its N//p - 1 multiples and to nothing else
    for p in (2, 3, 5, 7, 11, 251):
        assert deg[p - 1] == N // p - 1
    # a composite n is joined to its omega(n) distinct prime divisors
    for n in (12, 30, 210, 256, 496):
        assert deg[n - 1] == omega(n)
    assert deg[0] == 0  # node 1 has no prime divisors and is not prime


def test_csr_is_symmetric_and_matches_edges():
    g = build_graph(120, hub_edges=True)
    A = g.to_csr(weight="none")
    assert (A != A.T).nnz == 0
    assert A.nnz == 2 * g.n_edges
    assert A.diagonal().sum() == 0


def test_networkx_export_agrees():
    g = build_graph(150, hub_edges=True)
    G = g.to_networkx()
    assert G.number_of_nodes() == 150
    assert G.number_of_edges() == g.n_edges
    assert G[2][4]["vp"] == 2


def test_affinity_is_reciprocal_of_cost():
    g = build_graph(200)
    np.testing.assert_allclose(g.affinity, 1.0 / g.cost)


# -- null model ----------------------------------------------------------


def test_configuration_null_preserves_degrees_and_classes():
    g = build_graph(600, hub_edges=True)
    rng = np.random.default_rng(7)
    null = configuration_null(g, rng, swap_factor=5.0)
    np.testing.assert_array_equal(np.sort(g.degrees()), np.sort(null.degrees()))
    np.testing.assert_array_equal(g.degrees(), null.degrees())
    # bipartite class survives: divisibility edges still go prime -> non-prime
    for u, v, h in zip(null.src.tolist(), null.dst.tolist(), null.is_hub.tolist()):
        if not h:
            assert isprime(u)
            assert not isprime(v)


def test_configuration_null_is_simple_and_actually_rewires():
    g = build_graph(600, hub_edges=False)
    rng = np.random.default_rng(11)
    null = configuration_null(g, rng, swap_factor=5.0)
    keys = [tuple(sorted((int(u), int(v)))) for u, v in zip(null.src, null.dst)]
    assert len(keys) == len(set(keys))
    assert (null.src != null.dst).all()
    changed = (g.dst != null.dst).mean()
    assert changed > 0.5


def test_configuration_null_preserves_cost_multiset():
    g = build_graph(400, hub_edges=True)
    null = configuration_null(g, np.random.default_rng(3), swap_factor=5.0)
    np.testing.assert_allclose(np.sort(g.cost), np.sort(null.cost))


def test_null_is_seeded_and_reproducible():
    g = build_graph(400)
    a = configuration_null(g, np.random.default_rng(5), swap_factor=3.0)
    b = configuration_null(g, np.random.default_rng(5), swap_factor=3.0)
    np.testing.assert_array_equal(a.dst, b.dst)
