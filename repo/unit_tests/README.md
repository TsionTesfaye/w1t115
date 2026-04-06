# unit_tests/

Repo-level unit tests that run outside of the Angular build pipeline.

These tests are intended for utilities or logic that can run in Node without Angular's DI container or browser APIs. Use this directory for:

- Pure TypeScript logic that doesn't depend on IndexedDB
- Algorithm correctness tests (e.g. hash-chain verification with mocked crypto)
- State machine transition table completeness checks

## Running

```bash
# From repo root:
npx vitest run unit_tests/
```

Or via `run_tests.sh` (auto-detected if `.spec.ts` files are present).

## Note on Angular service tests

Tests for Angular services (AuthService, JobService, etc.) live in:

```
frontend/src/app/core/services/__tests__/
```

and run via `npx ng test`. They require the Angular test environment because the services use Angular's `inject()` function.
