# TalentBridge Internship Suite

A fully offline Angular 21 SPA for internship recruiting. Supports five roles — Candidate, Employer, HR Coordinator, Interviewer, Administrator — with all business logic enforced in the service layer and all domain data persisted in IndexedDB.

---

## How to Run

### With Docker (recommended)

```bash
docker compose up
```

**What happens:**

1. **Build** — Docker installs all npm dependencies (layer-cached after the first run).
2. **Tests** — `./run_tests.sh` executes the full Vitest suite. The container stops immediately if any test fails, so a green start means all tests passed.
3. **Serve** — `npm run dev` starts the Angular dev server on all interfaces.

**Port:** <http://localhost:4200>

**Notes:**
- Fully offline — no backend, no REST API, no network calls at runtime.
- All data is persisted in IndexedDB inside the browser tab.
- Tests do **not** run during the Docker image build (`RUN ./run_tests.sh` is intentionally absent from the Dockerfile); they run at container start so the output is visible in your terminal.

### Without Docker

```bash
npm install
npx ng serve          # dev server on http://localhost:4200
./run_tests.sh        # run all tests
```

---

## Architecture

### Storage

| Layer | What goes here |
|---|---|
| **IndexedDB** (`TalentBridgeDB`) | All domain data: users, sessions, jobs, applications, interviews, documents, messages, notifications, audit logs, etc. |
| **LocalStorage** | Session metadata (active session ID), scheduler leader-election keys |
| **Memory (signals)** | Reactive UI state derived from IndexedDB reads |

The app is fully offline-capable. There is no backend, no REST API, no network calls. Everything runs in the browser.

### Layer Diagram

```
┌──────────────────────────────────────────┐
│  Angular Components (UI only)            │
│  - Read signals, call service methods    │
│  - Never access repositories directly   │
├──────────────────────────────────────────┤
│  Services (business logic layer)         │
│  - RBAC / ABAC enforcement               │
│  - State machine transitions             │
│  - Optimistic locking (version field)    │
│  - Quota, rate limits, deduplication     │
├──────────────────────────────────────────┤
│  Repositories (data access layer)        │
│  - Thin wrappers around BaseRepository   │
│  - Typed reads/writes on named stores    │
├──────────────────────────────────────────┤
│  IndexedDB (TalentBridgeDB v1)           │
│  - 35+ object stores                    │
│  - Compound indexes for fast lookups     │
└──────────────────────────────────────────┘
```

### Key Design Decisions

**Fail-closed everywhere.** Invalid state-machine transitions throw `StateMachineError`. Unauthorized access throws `AuthorizationError`. The UI never suppresses these — they surface as toasts.

**No UI-only validation.** Every business rule lives in a service method. If a rule is worth enforcing, it is enforced whether the request arrives from a button click or a direct service call in a test.

**Optimistic locking.** Every entity has a `version: number` field. `updateWithLock()` in `BaseRepository` reads the current version, confirms it matches, then writes the incremented version atomically. Stale writes throw `OptimisticLockError`.

**Immutable audit log.** Each `AuditLog` entry includes a SHA-256 hash of `previousHash + current record`. `AuditService.verifyIntegrity()` walks the full chain; any tampering breaks the hash sequence.

**Scheduler leader election.** The `SchedulerService` uses two LocalStorage keys (`tb_scheduler_leader`, `tb_scheduler_heartbeat`) with a 30-second timeout to ensure exactly one tab runs background jobs (offer expiry, pin expiry, scheduled post publishing, DND release, webhook retries).

**Cross-tab sync.** `CrossTabService` wraps three `BroadcastChannel` instances (session, data, notifications). Logout in one tab propagates to all others. The service filters out its own messages using a per-tab UUID.

---

## Roles and Permissions

| Role | Key capabilities |
|---|---|
| **Candidate** | Browse jobs, submit applications, manage own documents, view own interviews |
| **Employer** | Create/manage jobs, review applications, schedule interviews |
| **HR Coordinator** | All employer capabilities + manage interview plans, run reports |
| **Interviewer** | View assigned interviews, submit feedback |
| **Administrator** | Full access + user management, moderation, governance, integration config |

Multi-role users see a role switcher in the nav bar. The active role determines which routes are accessible and which service operations are permitted.

---

## State Machines

All transitions are enforced by `assertTransition()` in `src/app/core/state-machines/index.ts`. Calling a service method with an invalid transition throws `StateMachineError` before any DB write occurs.

| Entity | States |
|---|---|
| Job | `draft → active → closed → archived` |
| Application stage | `draft → submitted → under_review → interview_scheduled → interview_completed → offer_extended` |
| Application status | `active → accepted / rejected / withdrawn / expired / deleted / archived` |
| ApplicationPacket | `draft → in_progress → submitted → reopened → locked` |
| Interview | `scheduled → completed / canceled` |
| ContentPost | `draft → scheduled → published → archived` |
| Comment | `pending → approved / rejected` |
| WebhookQueueItem | `pending → processing → delivered / failed` |

---

## Security

- **Passwords**: PBKDF2-SHA256, 100,000 iterations, 32-byte salt, 32-byte hash — all via Web Crypto API. No plaintext passwords are ever stored.
- **Encryption keys**: Derived from the user's password using a separate PBKDF2 salt (`encryptionKeySalt`). Used for AES-GCM document encryption.
- **HMAC verification**: Integration webhooks use HMAC-SHA256 with secret rotation grace (active + previous secret both checked).
- **Session lockout**: 5 failed attempts triggers a 15-minute lockout. CAPTCHA challenge activates after 3 failures.
- **XSS**: All user-generated content goes through `sanitizePlainText()` or `sanitizeHtml()` before persistence. Dangerous tags (`<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`) are stripped; event handlers and `javascript:` URLs are removed.

---

## Running Tests

```bash
./run_tests.sh            # run once (exits non-zero on failure)
./run_tests.sh --watch    # watch mode
./run_tests.sh --coverage # with coverage report
```

Current coverage: **459 tests, all passing**.

Test files:
- `src/app/app.spec.ts` — App smoke test
- `src/app/core/services/__tests__/state-machines.spec.ts` — 25 state machine transition tests
- `src/app/core/services/__tests__/sanitizer.spec.ts` — XSS sanitization
- `src/app/core/services/__tests__/masking.spec.ts` — PII masking utilities
- `src/app/core/services/__tests__/constants.spec.ts` — Business-critical constant validation

---

## Project Structure

```
repo/
├── run_tests.sh              # test runner (npx vitest run src/app/core/)
├── Dockerfile                # Node 18: install → test → serve
├── docker-compose.yml        # docker compose up
├── package.json
├── angular.json
├── vitest.config.ts
├── tsconfig.json
├── README.md
├── docs/
├── unit_tests/
├── API_tests/
└── src/app/
    ├── core/
    │   ├── constants/        # AUTH, DOCUMENT, SCHEDULER constants
    │   ├── db/               # Database, BaseRepository, AuditLogRepository
    │   ├── enums/            # All domain enums
    │   ├── errors/           # Typed error hierarchy
    │   ├── guards/           # authGuard, roleGuard
    │   ├── models/           # All TypeScript interfaces
    │   ├── repositories/     # 32 typed IndexedDB repositories
    │   ├── services/         # All business-logic services + __tests__/
    │   ├── state-machines/   # Transition maps + assertTransition()
    │   └── utils/            # id, sanitizer, masking
    ├── modules/              # 14 lazy-loaded feature modules
    ├── shared/               # LoadingState, ErrorState, EmptyState
    ├── shell/                # AppShell nav component
    ├── app.routes.ts
    └── app.ts                # Root component + scheduler bootstrap
```
