# Evidence report

- run_id: `run_01K3H7WQ0R8SAMPLEAUTH`
- goal: Fix the failing auth tests and prove they pass
- phase: ACCEPT
- status: accepted
- created_at: 2026-08-20T12:00:00.000Z
- updated_at: 2026-08-20T12:18:22.000Z

## Acceptance

- A1: npm test -- auth exits 0 **pass**
- A2: Auth mismatch responses use HTTP 401 **pass**

## Findings

Verdict: **accepted** — Deterministic checks passed: npm test -- auth

- none

## Evidence files

- E1 [test] `evidence/A1-test.log` exit=0
- E2 [diff] `evidence/auth.diff`

## Event log

- 2026-08-20T12:00:00.000Z run_created (INTAKE)
- 2026-08-20T12:18:22.000Z run_accepted (ACCEPT)

This snapshot is checked in so a stranger can see what Accepted evidence looks like. It was not produced by calling MiniMax from CI.
