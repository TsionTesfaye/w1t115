Project Type: web

# TalentBridge Internship Suite

A fully offline Angular SPA for internship recruiting. Supports five roles — Candidate, Employer, HR Coordinator, Interviewer, Administrator — with all business logic enforced in the service layer and all domain data persisted in IndexedDB.

---

## Startup

> **All runtime setup is Docker-contained. No local Node.js install required.**

```bash
docker-compose up
```

(`docker compose up` also works with Docker Compose V2.)

**What happens inside the container:**

1. Dependencies are pre-installed during the Docker image build (layer-cached; no runtime install step).
2. `./run_tests.sh` — runs the full Vitest suite; the container stops immediately on any failure.
3. The Angular dev server starts on all interfaces.

**Access:** <http://localhost:4200>

---

## Authentication

Demo accounts are seeded automatically at startup. No manual registration or admin setup required — go straight to `/login`.

| Role | Username | Password |
|---|---|---|
| Administrator | `admin` | `Admin@2025!` |
| HR Coordinator | `hr` | `HrCoord@25!` |
| Employer | `employer` | `Employ@2025!` |
| Interviewer | `interviewer` | `Intrvw@2025!` |
| Candidate | `candidate` | `Candidat@25!` |

All accounts belong to organisation `demo-org`.

---

## Verification

Step-by-step walkthrough to confirm the app is working after `docker-compose up`:

### 1. Login
- Open <http://localhost:4200> — you are redirected to `/login`.
- Enter `admin` / `Admin@2025!`.
- **Expected:** Dashboard loads; Administrator role is active in the nav bar.

### 2. User management (Administrator)
- Navigate to **Admin**.
- **Expected:** All five seeded users appear in the user list.
- Try changing a user's role — the change is saved and audited.

### 3. Job posting (Employer)
- Log out. Log in as `employer` / `Employ@2025!`.
- Navigate to **Jobs** → create a new job, set it to `Active`.
- **Expected:** Job appears in the list with status `Active`.

### 4. Application (Candidate)
- Log out. Log in as `candidate` / `Candidat@25!`.
- Navigate to **Jobs** — the employer's active job is visible.
- Apply → submit the application.
- **Expected:** Application appears in **Applications** with stage `Submitted`.

### 5. Interview scheduling (HR Coordinator)
- Log out. Log in as `hr` / `HrCoord@25!`.
- Navigate to **Applications** → advance the application to `Interview Scheduled`.
- Navigate to **Interviews** → schedule an interview, assign `interviewer`.
- **Expected:** Interview appears with status `Scheduled`.

### 6. Feedback (Interviewer)
- Log out. Log in as `interviewer` / `Intrvw@2025!`.
- Navigate to **Interviews** → open the interview → mark **Completed**.
- Submit feedback (score 1–10 + notes).
- **Expected:** Feedback saved; interviewer sees their own entry.

### 7. Notifications
- Any role: navigate to **Notifications**.
- **Expected:** Relevant notifications appear (application received, interview scheduled, etc.).

### 8. Test suite
```bash
docker-compose run --rm app ./run_tests.sh
```
**Expected:** `Test Files  51 passed (51)` · `Tests  657 passed (657)`.

---

## Role Matrix

| Role | One verifiable UI action |
|---|---|
| Administrator | User list in Admin console; role changes; audit log access |
| HR Coordinator | Interview scheduling; audit log search |
| Employer | Job creation and publishing; application review |
| Interviewer | View assigned interviews; submit feedback |
| Candidate | Apply to jobs; view own applications and documents |

---

## Architecture

### Storage

| Layer | Purpose |
|---|---|
| **IndexedDB** (`TalentBridgeDB`) | All domain data: users, sessions, jobs, applications, interviews, documents, messages, notifications, audit logs |
| **LocalStorage** | Active session ID; scheduler leader-election keys |
| **Memory (signals)** | Reactive UI state derived from IndexedDB reads |

Fully offline — no backend, no REST API, no network calls at runtime.

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
│  IndexedDB (TalentBridgeDB)              │
│  - 35+ object stores                    │
│  - Compound indexes for fast lookups     │
└──────────────────────────────────────────┘
```

### Key Design Decisions

**Fail-closed.** Invalid state-machine transitions throw `StateMachineError`. Unauthorized access throws `AuthorizationError`. The UI never suppresses these.

**No UI-only validation.** Every business rule lives in a service method, enforced whether the call comes from a button or a test.

**Optimistic locking.** Every entity has a `version` field. `updateWithLock()` confirms the version, then increments atomically. Stale writes throw `OptimisticLockError`.

**Immutable audit log.** Each `AuditLog` entry includes a SHA-256 hash chained to the previous entry. `AuditService.verifyIntegrity()` walks the full chain; tampering breaks the sequence.

**Scheduler leader election.** `SchedulerService` uses two LocalStorage keys with a 30-second timeout so exactly one browser tab runs background jobs (offer expiry, webhook retries, daily digests).

**Cross-tab sync.** `CrossTabService` wraps three `BroadcastChannel` instances (session, data, notifications). Logout in one tab propagates to all others via the session channel.

---

## Roles and Permissions

| Role | Key capabilities |
|---|---|
| **Candidate** | Browse jobs, submit applications, manage own documents, view own interviews |
| **Employer** | Create/manage jobs, review applications, schedule interviews |
| **HR Coordinator** | All Employer capabilities + interview plans, audit log search |
| **Interviewer** | View assigned interviews, submit feedback |
| **Administrator** | Full access + user management, moderation, governance, integration config |

Multi-role users see a role switcher in the nav bar. The active role determines which routes are accessible and which service operations are permitted.

---

## State Machines

All transitions are enforced by `assertTransition()`. Calling a service method with an invalid transition throws `StateMachineError` before any DB write occurs.

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

- **Passwords**: PBKDF2-SHA256, 100,000 iterations, 32-byte salt, via Web Crypto API. No plaintext passwords stored.
- **Encryption keys**: Derived from the user's password via a separate PBKDF2 salt for AES-GCM document encryption.
- **HMAC verification**: Integration webhooks use HMAC-SHA256 with secret rotation support.
- **Session lockout**: 5 failed attempts → 15-minute lockout. CAPTCHA after 3 failures.
- **XSS**: All user content passes through `sanitizePlainText()` / `sanitizeHtml()` before persistence. Dangerous tags and `javascript:` URLs are stripped.

---

## Testing

All tests run inside Docker. No local install needed.

```bash
# Full suite (also runs automatically on docker-compose up)
docker-compose run --rm app ./run_tests.sh

# Coverage report
docker-compose run --rm app ./run_tests.sh --coverage
```

**Current coverage: 657 tests across 51 files — all passing.**

### Suite breakdown

| Directory | What it validates |
|---|---|
| `src/app/core/services/__tests__/` | Service-layer business logic: RBAC, ABAC, state machines, crypto, audit chain, feedback, cross-tab messaging, scheduler leader election |
| `src/app/core/guards/__tests__/` | `authGuard` and `roleGuard` on protected and public routes |
| `src/app/modules/**/pages/__tests__/` | Component integration: TestBed rendering, user interactions, role-specific UI paths |
| `unit_tests/` | Standalone units: ABAC helpers, DND delay logic, digest display |
| `API_tests/` | HMAC signature verification for webhook and service-worker endpoints |
| `browser_tests/` | Real fetch + IndexedDB flows in a jsdom environment |
| `e2e_tests/` | End-to-end user journey: login → job → application → interview → feedback |

---

## Project Structure

```
repo/
├── run_tests.sh              # test runner (build gate + vitest)
├── Dockerfile                # node:18-alpine — install → test → serve
├── docker-compose.yml        # docker-compose up
├── package.json
├── angular.json
├── vitest.config.ts
├── tsconfig.json
└── src/app/
    ├── core/
    │   ├── constants/        # AUTH, DOCUMENT, SCHEDULER constants
    │   ├── db/               # Database, BaseRepository, AuditLogRepository
    │   ├── enums/            # All domain enums
    │   ├── errors/           # Typed error hierarchy
    │   ├── guards/           # authGuard, roleGuard
    │   ├── models/           # All TypeScript interfaces
    │   ├── repositories/     # 32 typed IndexedDB repositories
    │   ├── services/         # Business logic + __tests__/
    │   ├── state-machines/   # Transition maps + assertTransition()
    │   └── utils/            # id, sanitizer, masking
    ├── modules/              # 14 lazy-loaded feature modules
    ├── shell/                # AppShell nav component
    ├── app.routes.ts
    └── app.ts                # Root component + scheduler bootstrap
```
