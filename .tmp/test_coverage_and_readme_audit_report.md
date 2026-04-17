# Test Coverage Audit

## Scope
- Audit mode: static inspection only.
- Project type detected from README top line: `web` (`README.md:1`).
- Frontend-only scoring applied per project nature and user instruction.

## Backend Endpoint Inventory
- Backend server endpoints discovered: **0**.
- Evidence:
  - Client-side route table only: `src/app/app.routes.ts:17-151`.
  - README explicitly states no backend/REST runtime: `README.md:116`.

## API Test Mapping Table
| Endpoint | Covered | Test Type | Test Files | Evidence |
|---|---|---|---|---|
| Backend API endpoints | N/A (none exist) | N/A | N/A | No backend controller/router/server endpoints found |

## API Test Classification
Because backend endpoints are absent, classifications below apply to API-like simulator tests only.

1. True No-Mock HTTP
- `browser_tests/real-fetch-e2e.spec.ts` (real HTTP server + real fetch + real crypto): `browser_tests/real-fetch-e2e.spec.ts:35-66`, `:91-183`.

2. HTTP with Mocking
- `API_tests/sw-hmac.spec.ts` uses `vi.stubGlobal('fetch', ...)`: `API_tests/sw-hmac.spec.ts:52,79,102,122`.
- `API_tests/webhook-hmac.spec.ts` uses `vi.stubGlobal('fetch', ...)`: `API_tests/webhook-hmac.spec.ts:121,143,164`.
- `browser_tests/integration-request-flow.spec.ts` uses `vi.stubGlobal('fetch', ...)`: `browser_tests/integration-request-flow.spec.ts:80,138`.
- `src/app/modules/integration/pages/__tests__/integration-console.component.spec.ts` uses fetch stubbing: `src/app/modules/integration/pages/__tests__/integration-console.component.spec.ts:57`, `:254`, `:264`.

3. Non-HTTP (unit/integration without HTTP)
- Service/unit/component suites in:
  - `src/app/core/services/__tests__/...`
  - `src/app/modules/**/pages/__tests__/...`
  - `src/app/core/guards/__tests__/guards.spec.ts`
  - `unit_tests/*.spec.ts`

## Mock Detection
Detected mock/stub patterns (examples with file evidence):
- `vi.stubGlobal('fetch', ...)`:
  - `API_tests/sw-hmac.spec.ts:52,79,102,122`
  - `API_tests/webhook-hmac.spec.ts:121,143,164`
  - `browser_tests/integration-request-flow.spec.ts:80,138`
  - `src/app/modules/integration/pages/__tests__/integration-console.component.spec.ts:57,254,264`
- Mocked service/provider overrides in component tests:
  - `ApplicationService` mock object: `src/app/modules/applications/pages/__tests__/application-detail.component.spec.ts:67-73`, injected at `:82`.
  - `InterviewService` and `FeedbackService` mock objects: `src/app/modules/interviews/pages/__tests__/interview-detail.component.spec.ts:79-92`, injected at `:100-101`.
  - `AuthService`/`UserRepository` mock objects: `src/app/modules/auth/pages/__tests__/setup.component.spec.ts:16-22`, injected at `:32-33`.

## Coverage Summary
- Total backend endpoints: **0**.
- Endpoints with HTTP tests: **N/A**.
- Endpoints with true no-mock backend API tests: **N/A**.
- HTTP coverage % (backend): **N/A**.
- True API coverage % (backend): **N/A**.

## Unit Test Summary
### Backend Unit Tests
- Backend modules tested: **N/A** (no backend server/API layer present).
- Important backend modules not tested: **N/A**.

### Frontend Unit Tests (STRICT)
- **Frontend unit tests: PRESENT**.

Detection criteria validation:
- Identifiable test files exist: yes (58 spec files total): `rg --files ... | wc -l` result = `58`.
- Tests target frontend logic/components: yes (module page specs and service specs).
- Framework evident: yes (`vitest.config.ts:1-31`, Angular TestBed imports across page specs).
- Tests import/render frontend components/modules: yes (example: `src/app/modules/application-packet/pages/__tests__/application-packet.component.spec.ts:18`; `src/app/modules/jobs/pages/__tests__/job-list.component.spec.ts:13`).

Frontend test files (representative inventory):
- Page component tests in `src/app/modules/**/pages/__tests__/` including:
  - `application-packet.component.spec.ts`
  - `job-list.component.spec.ts`
  - `job-detail.component.spec.ts`
  - `dashboard.component.spec.ts`
  - `application-detail.component.spec.ts`
  - `interview-detail.component.spec.ts`
  - and other route pages.
- Service/guard/unit/e2e/browser tests in:
  - `src/app/core/services/__tests__/`
  - `src/app/core/guards/__tests__/guards.spec.ts`
  - `unit_tests/`, `browser_tests/`, `e2e_tests/`, `API_tests/`.

Components/modules covered:
- All route page components in `src/app/modules/*/pages/*.component.ts` have direct page-level specs (18/18):
  - Pages list: `src/app/modules/**/pages/*.component.ts`
  - Matching specs list: `src/app/modules/**/pages/__tests__/*.spec.ts`

Important frontend components/modules not tested (strictly significant):
- No major route page gap found.
- Residual weaker areas are quality-related (mocking depth), not missing-file presence.

### Cross-Layer Observation
- Project is web frontend-only; testing is appropriately frontend-heavy.

## API Observability Check
- Backend API observability: N/A (no backend endpoints).
- Simulator/frontend HTTP observability:
  - Strong in `API_tests/sw-endpoints.spec.ts` where method/path/request/response are explicit (e.g., `describe('SW endpoint — GET /jobs (list)')` at `API_tests/sw-endpoints.spec.ts:247`, assertions on response body/status across `:247-493`).
  - Strong in real-fetch e2e with echoed request headers/body (`browser_tests/real-fetch-e2e.spec.ts:91-183`).
  - Reduced realism where fetch is stubbed (files listed under Mock Detection).

## Test Quality & Sufficiency
- Success-path coverage: strong across service and component suites.
- Failure/edge coverage: present (lockouts, optimistic lock, validation, auth/role errors, retry behavior).
- Validation/auth/permissions: substantial service-level coverage.
- Integration boundaries:
  - Strong where real services run with fake repositories.
  - Weaker where component tests inject mocked services (not executing service business logic).
- Autogenerated/superficial signal: low; most tests contain explicit behavioral assertions.

## Tests Check
- `run_tests.sh` dependency policy: Docker-based, no local install/build inside script.
  - Evidence: `run_tests.sh:40-41` comment and command flow.
- Verdict for this check: **OK**.

## End-to-End Expectations
- Fullstack FE↔BE expectation does not apply (web frontend-only).
- Frontend end-to-end style coverage exists:
  - `e2e_tests/user-flow.spec.ts` (service-layer full flow)
  - `browser_tests/real-fetch-e2e.spec.ts` (real transport flow)
  - `browser_tests/packet-wizard.spec.ts` and `browser_tests/application-packet-flow.spec.ts` (packet flow depth)

## Test Coverage Score (0–100)
- **93/100** (frontend-only absolute score).

## Score Rationale
- Strong breadth and depth across 58 static test files.
- Full route-page component test presence (18/18).
- Good negative/edge-case depth (optimistic locking, role/auth constraints, validation).
- Score reduced due to remaining avoidable mock-heavy component suites and fetch stubbing in several integration/API-like tests.

## Key Gaps
1. Mock-heavy page specs still bypass real service logic in key files:
   - `src/app/modules/applications/pages/__tests__/application-detail.component.spec.ts:67-73,82`
   - `src/app/modules/interviews/pages/__tests__/interview-detail.component.spec.ts:79-92,100-101`
   - `src/app/modules/auth/pages/__tests__/setup.component.spec.ts:16-22,32-33`
2. Transport-level stubbing remains in API/integration suites:
   - `API_tests/sw-hmac.spec.ts:52,79,102,122`
   - `API_tests/webhook-hmac.spec.ts:121,143,164`
   - `browser_tests/integration-request-flow.spec.ts:80,138`
   - `src/app/modules/integration/pages/__tests__/integration-console.component.spec.ts:57,254,264`
3. `API_tests/sw-endpoints.spec.ts` validates a test-side reimplementation of SW handlers rather than directly executing `src/sw.js` handler entrypoint (`API_tests/sw-endpoints.spec.ts:7-13`, `:67-204`).

## Confidence & Assumptions
- Confidence: **High**.
- Assumptions:
  - Static inspection only (no runtime validation executed).
  - Backend endpoint coverage metrics are N/A due to frontend-only architecture.

## Test Coverage Verdict
- **PASS WITH GAPS**

---

# README Audit

## README Location
- Required location exists: `repo/README.md`.

## Hard Gates
### Formatting
- PASS: readable markdown structure and sectioning.

### Startup Instructions
- Project type `web`.
- Includes required startup command for this project setup:
  - `docker-compose up` at `README.md:14`.

### Access Method
- PASS: URL + port documented at `README.md:25`.

### Verification Method
- PASS: explicit UI verification workflow at `README.md:45-91`.

### Environment Rules (STRICT)
- PASS: runtime docker-contained statement at `README.md:11` and explicit no runtime install step at `README.md:21`.
- No forbidden manual install steps detected in startup instructions.

### Demo Credentials (Conditional)
- PASS: auth exists and credentials are provided for all roles at `README.md:33-40`.

## Engineering Quality
- Tech stack clarity: strong.
- Architecture explanation: strong and concrete.
- Testing instructions: explicit and Docker-oriented.
- Security/roles/workflows: clearly documented.
- Presentation quality: good.

## High Priority Issues
- None.

## Medium Priority Issues
- None.

## Low Priority Issues
- None.

## Hard Gate Failures
- None.

## README Verdict
- **PASS**

---

# Final Combined Verdict
- Test Coverage Audit Verdict: **PASS WITH GAPS**
- README Audit Verdict: **PASS**
