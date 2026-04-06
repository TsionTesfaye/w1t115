# questions.md

## Business Logic Questions Log

---

### 1. Multi-Organization Scope & Ownership

**Question:**
The prompt references Employers, HR Coordinators, and Administrators but does not explicitly define whether the system supports multiple organizations or a single global environment.

**Assumption:**
The system supports multiple organizations, and all core entities (jobs, applications, interviews, documents) are scoped to an organization.

**Solution:**

* Introduced `organizationId` on all domain entities
* Enforced scope resolution from stored data (never from input)
* All reads/writes filtered by organization context

---

### 2. User Role Assignment & Multi-Role Support

**Question:**
The prompt defines multiple roles but does not clarify whether a single user can have multiple roles simultaneously.

**Assumption:**
A user can have multiple roles (e.g., Employer + Interviewer), but actions must respect role-specific permissions.

**Solution:**

* Implemented RBAC with role array per user
* Permission checks enforced at service layer
* UI renders capabilities based on active role context

---

### 3. Application Lifecycle State Machine (UPDATED)

**Question:**
The application process (apply → review → interview → offer) is implied but not explicitly defined as a strict state machine.

**Assumption:**
Applications follow a strict lifecycle with no skipping or backward transitions without explicit actions.

**Solution:**
Defined and enforced state machine:

* draft → submitted → under_review → interview_scheduled → interview_completed → offer_extended → accepted/rejected

* submitted / under_review / interview stages → withdrawn

* draft → deleted (not withdrawn)

* Added separation:

  * `stage` = lifecycle progression
  * `status` = active / withdrawn / archived

* All transitions validated in service layer

* Invalid transitions rejected

---

### 4. Interview Scheduling Conflict Rules

**Question:**
The prompt mentions interview plans but does not define conflict handling (double booking, interviewer availability).

**Assumption:**

* An interviewer cannot have overlapping interviews
* A candidate cannot have overlapping interviews

**Solution:**

* Implemented time-slot validation
* Conflict detection enforced in service layer
* Scheduling rejected if overlap exists

---

### 5. Message Center Delivery Model

**Question:**
The prompt defines messaging, digests, and DND windows but does not clarify delivery priority or batching rules.

**Assumption:**

* Real-time events are stored immediately
* Delivery respects user preferences (instant vs digest)

**Solution:**

* Stored all events in IndexedDB
* Built delivery layer:

  * instant delivery (if enabled)
  * daily digest aggregation
* DND windows delay delivery but do not drop messages

---

### 6. Notification Deduplication & Idempotency (UPDATED)

**Question:**
Event-driven notifications are defined, but duplicate event handling is not specified.

**Assumption:**
Each event should be processed once per user per event type, with additional rate limiting.

**Solution:**

* Implemented idempotency keys per event
* Stored processed event hashes
* Duplicate notifications skipped
* Added rate limit:

  * max 3 notifications per type per day
  * overflow routed to digest

---

### 7. Document Access Permissions

**Question:**
The prompt states document access depends on role and record status but does not define exact rules.

**Assumption:**

* Candidates can access their own documents
* Employers/HR can access documents for jobs they own
* Access depends on application stage

**Solution:**

* Implemented ABAC rules:

  * ownership (job/application)
  * role
  * stage
* Enforced at service layer for all reads

---

### 8. File Storage & Size Limit Enforcement

**Question:**
File limits are defined (25MB/file, 200MB/account), but enforcement timing is not specified.

**Assumption:**
Limits must be enforced before storage to prevent overflow.

**Solution:**

* Validated file size before upload
* Maintained per-user storage usage tracker
* Rejected uploads exceeding limits

---

### 9. Watermarking Behavior

**Question:**
Watermarking is optional but not defined in terms of when it applies.

**Assumption:**
Watermarking applies during preview and download, not storage.

**Solution:**

* Original file stored unchanged
* Watermark applied dynamically on preview/download
* Includes user name + timestamp

---

### 10. Integration Simulator Scope

**Question:**
The “Open API and webhook” simulator is defined but not scoped (real networking vs simulated).

**Assumption:**
All integrations are simulated locally via Service Worker interception.

**Solution:**

* Implemented request interceptor (Service Worker)
* Simulated:

  * REST requests
  * idempotency keys (24h)
  * rate limiting (fixed window 60/min)
  * HMAC verification with secret versioning
* Outbound queue handles retries

---

### 11. Retry & Backoff Strategy

**Question:**
Retry rules are defined but failure persistence is not specified.

**Assumption:**
Failed events must persist and retry even after reload.

**Solution:**

* Implemented persistent outbound queue in IndexedDB
* Retry with exponential backoff
* Max 5 attempts over 15 minutes

---

### 12. Audit Log Scope & Immutability (UPDATED)

**Question:**
Audit logging is required but not scoped in detail.

**Assumption:**
All critical actions must be logged and immutable.

**Solution:**

* Logged:

  * auth events
  * role changes
  * job/application actions
  * document access
* Stored append-only logs
* Added hash-chain (`previousHash`) for tamper detection

---

### 13. Sensitive Data Definition

**Question:**
The prompt states encryption of sensitive fields but does not define which fields qualify.

**Assumption:**
Sensitive fields include:

* personal identifiers
* uploaded documents
* private messages

**Solution:**

* Encrypted sensitive fields using AES-GCM
* Key derived via WebCrypto
* Masked UI display where required

---

### 14. Brute Force & CAPTCHA Enforcement (UPDATED)

**Question:**
The prompt defines lockout and CAPTCHA but not interaction order.

**Assumption:**
CAPTCHA appears before lockout.

**Solution:**

* After 3 failed attempts → CAPTCHA required
* After 5 failed attempts → 15-minute lockout
* CAPTCHA does NOT reset counter
* Stored attempt tracking in IndexedDB

---

### 15. Privilege Escalation Detection

**Question:**
The prompt requires detection of unauthorized role changes but does not define detection logic.

**Assumption:**
Any role change outside Admin workflows is suspicious.

**Solution:**

* Tracked role changes with audit logs
* Triggered alert if:

  * role changed without Admin action
* Flag stored for review

---

### 16. Content Moderation Rules

**Question:**
The moderation system defines rules but not enforcement strictness.

**Assumption:**
Violations block submission immediately.

**Solution:**

* Implemented:

  * blocklisted words
  * max 3 links
  * 30-second cooldown
* Violations rejected at service layer

---

### 17. Data Import / Export Conflict Handling (UPDATED)

**Question:**
Import/export is defined but conflict resolution is unclear.

**Assumption:**
Imports must be explicit and safe.

**Solution:**

* Implemented:

  * schema validation
  * preview before import
* User chooses:

  * overwrite
  * merge (by ID)
* Audit logs are NOT importable

---

### 18. Dataset Versioning & Snapshots (UPDATED)

**Question:**
Dataset versioning is mentioned but not defined.

**Assumption:**
Snapshots should be lightweight.

**Solution:**

* Stored metadata-only snapshots
* Excluded large blobs
* Snapshot count capped per organization

---

### 19. Multi-Tab Consistency (UPDATED)

**Question:**
Offline system does not define multi-tab synchronization.

**Assumption:**
State must remain consistent across tabs.

**Solution:**

* Implemented BroadcastChannel sync
* Added optimistic locking using version field
* Prevented stale overwrites

---

### 20. Offline-First Guarantees

**Question:**
The system is offline but includes API-like features.

**Assumption:**
All logic must function without network dependency.

**Solution:**

* No external API calls
* All logic implemented in service layer
* Integration simulator fully local

---

### 21. Offer Expiration Logic

**Question:**
Offer expiration is referenced but not defined.

**Assumption:**
Offers must expire automatically.

**Solution:**

* Added `offerExpiresAt` field
* Scheduler processes expiration
* Triggers notification and optional status update

---

### 22. Application Creation Constraints

**Question:**
Application duplication and invalid submissions are undefined.

**Assumption:**
Applications must be unique and valid.

**Solution:**

* One application per candidate per job
* Cannot apply to closed/archived jobs
* Must match organization

---

### 23. Feedback Visibility Rules

**Question:**
Feedback visibility is undefined.

**Assumption:**
Visibility depends on role and stage.

**Solution:**

* Candidate: no access
* Interviewer: own only
* Employer/HR: after completion

---

### 24. Thread Authorization Rules

**Question:**
Messaging permissions are undefined.

**Assumption:**
Messaging must be context-bound.

**Solution:**

* Threads scoped to job/application
* Candidate ↔ Employer only if applied
* Interviewer ↔ Candidate only if assigned

---

### 25. Content Publishing Authorization

**Question:**
Publishing permissions unclear.

**Assumption:**
Only operational roles publish.

**Solution:**
Allowed:

* Employer
* HR Coordinator
* Administrator

---

### 26. Session Timeout Definition

**Question:**
Session expiration undefined.

**Assumption:**
Sessions must expire after inactivity.

**Solution:**

* 30-minute inactivity timeout
* 7-day remember session

---

### 27. Scheduler Concurrency Control

**Question:**
Multiple schedulers may run across tabs.

**Assumption:**
Only one scheduler should execute.

**Solution:**

* Implemented leader election via LocalStorage
* Single active scheduler

---

### 28. Interview Rescheduling Behavior

**Question:**
Rescheduling not clearly defined.

**Assumption:**
Rescheduling updates existing interview.

**Solution:**

* Same interview ID updated
* Audit entry required
* Notification triggered

---

### 29. Pin Expiration Enforcement

**Question:**
Pinned content duration not enforced.

**Assumption:**
Pins must expire automatically.

**Solution:**

* Scheduler removes pins after 7 days

---

### 30. Job Lifecycle Interaction with Applications

**Question:**
Job closure impact on applications undefined.

**Assumption:**
Existing applications should continue.

**Solution:**

* Closing job blocks new applications
* Existing applications proceed normally

---
