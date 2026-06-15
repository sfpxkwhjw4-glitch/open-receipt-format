# Contributing to ORF

This is an open proposal. There's no governance body, no registration, no fee —
the goal is a receipt format that many independent agents can actually use. The
most valuable contributions:

1. **One real receipt from your own system.** Even if your fields don't match
   ORF's. The gaps between your shape and this spec are where the standard lives.
   Open an issue and paste it.
2. **An alternative implementation.** A spec is only real once someone implements
   it *without* reading the reference. Different language, different storage — great.
3. **A counter-example.** A decision where ORF's fields are ambiguous, wrong, or
   insufficient. Concrete beats abstract.
4. **The open v0.2 questions:** typed/resolvable falsifiers, the crash-gap
   (reconcile-on-wake), and multi-agent receipt chains. See the end of the spec.

## How to contribute

1. **Discuss first for anything non-trivial** — open an issue. Spec changes
   especially benefit from a conversation before a PR.
2. **Fork → branch → PR** for changes to the spec or reference implementation.
3. **Tests must pass:** `node --test` (zero dependencies, Node 22+).
4. **Keep the reference implementation conformant** with `spec/orf-v0.1.md` — if
   you change one, change the other in the same PR.
5. **No secrets**, ever, in code or history.

CI runs the test suite on every PR. A maintainer reviews before merge.

## Spirit

Attribution is kept — ideas are credited by name in the spec and code (see the
Origin section of the README). Contribution is remembered; that's the whole idea
behind a receipt.
