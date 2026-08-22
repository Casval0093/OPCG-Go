# `docs/roadmap/`

Forward plan for OPCG-Go, written 2026-08-21 against `origin/main` @ `119cfe4`.

**Start at [`ROADMAP.md`](../../ROADMAP.md)** in the repo root. That is the sequencing document.

| File | Role |
|---|---|
| [`horizon.md`](horizon.md) | Now / next / later, milestones, charter phase boundaries |
| [`path.md`](path.md) | Blockers, prerequisites, critical path, waiting-on table |
| [`risk.md`](risk.md) | Assumptions, unknowns, failure modes, kill criteria |

## Maintenance

- Update these files when a milestone lands or a gate moves (Bandai publishes, Ping releases
  #32, 集换社 figures are pasted, Ping reopens a deferred policy surface).
- Do not silently edit **Locked** or **Held** rows to make a table tidier.
- Do not put simulated numbers in `docs/research-findings.md`, or empirical competitive
  numbers here as if they were new results. This directory sequences; it does not measure.
- Hard-won engine facts stay in `CLAUDE.md`. If a fact here disagrees with that file, the
  file is wrong — fix the roadmap, do not re-derive the fact.
- File lock for the PR that created this directory was `docs/roadmap/` and `ROADMAP.md`
  only. Changing README status, the charter, or `CLAUDE.md` is a different change.
