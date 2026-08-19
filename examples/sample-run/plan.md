# Plan

Goal: Fix the failing auth tests and prove they pass

## Discovery

- Tests: `npm test -- auth`
- Failure: `tests/auth.test.js` expects `401` on bad password; handler returned `500`.
- File: `src/auth.js` `verifyPassword` throws on mismatch instead of returning false.

## DAG

1. T1 Explorer — locate test command (done)
2. T2 Builder — return 401 on invalid credentials
3. T3 Verifier — rerun auth tests

## Acceptance

- A1: `npm test -- auth` exits 0
- A2: no product file outside `src/auth.js` / `tests/auth.test.js`
