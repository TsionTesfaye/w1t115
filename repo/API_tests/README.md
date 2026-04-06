# API_tests/

Integration and API-level tests for TalentBridge.

Since TalentBridge has no backend, "API tests" in this context means:

1. **Service integration tests** — test multiple services working together through their public interfaces (e.g., full auth flow: register → login → CAPTCHA → lockout)
2. **Data integrity tests** — verify cross-entity consistency (e.g., lineage links created correctly when an application is submitted)
3. **Scheduler behavior tests** — verify that the scheduler correctly processes expirations and retries

## Running

```bash
# From repo root:
npx vitest run API_tests/
```

Or via `run_tests.sh` (auto-detected if `.spec.ts` files are present).

## Environment Requirements

These tests require a browser-compatible environment with IndexedDB support. Use `@vitest/browser` or run them with Playwright to get a real browser context.

For in-memory IDB testing without a real browser, use `fake-indexeddb` (install as devDependency):

```bash
cd frontend && npm install --save-dev fake-indexeddb
```

Then import it at the top of test files:

```typescript
import 'fake-indexeddb/auto';
```
