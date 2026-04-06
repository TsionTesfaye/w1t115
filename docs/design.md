# design.md

## 1. System Overview

TalentBridge Internship Suite is a fully offline, English-only Angular single-page application (SPA) for end-to-end internship recruiting operations.

The system supports five primary roles:

- Candidate
- Employer
- HR Coordinator
- Interviewer
- Administrator

The application runs entirely in the browser with no backend service. All business logic is enforced through a frontend service layer. IndexedDB is the primary persistence layer for operational data, files, logs, queues, governance metadata, and snapshots. LocalStorage is used only for lightweight session metadata and UI preferences.

The product must behave like a complete operational system, not a static UI demo. It supports:

- role-based workspaces
- job posting and job lifecycle management
- candidate application submission and tracking
- guided Application Packet completion
- interview planning and scheduling
- document upload, validation, preview, watermarking, and download controls
- in-app messaging and event-driven alerts
- subscription toggles by event type
- daily message digest generation
- Do Not Disturb (DND) delivery windows
- content publishing, tagging, scheduling, pinning, and comment moderation
- local integration simulation through an in-app REST-like request console and Service Worker interception
- immutable audit logging
- data dictionary, lineage views, metric definitions, and dataset snapshots
- local export/import for backup and device-to-device transfer

Because this is a pure frontend system, all security is local and simulation-grade. However, internal rules must still be implemented with strict service-layer enforcement and fail-closed behavior so the system remains QA-credible and architecturally sound.

---

## 2. Design Goals

### 2.1 Product Goals

- Support the full internship recruiting lifecycle from job creation through application review, interview coordination, offer handling, and document review
- Provide role-based workspaces with permission-aware navigation and scoped access
- Allow Candidates to complete a guided Application Packet wizard with validation and draft save
- Provide an in-app Message Center with notifications, subscriptions, read receipts, daily digests, and DND windows
- Enable authorized users to publish announcements and short updates with tags, schedules, pinning, and moderated comments
- Support secure local document handling with role- and status-sensitive access controls
- Simulate external APIs and webhooks locally for integration testing workflows
- Provide governance tooling including audit logs, metric definitions, data dictionary views, lineage views, and dataset snapshots

### 2.2 Engineering Goals

- Fully offline operation with no network dependency
- Clear separation between UI, services, repositories, and system runtime modules
- Strong service-layer validation and state-machine enforcement
- Deterministic workflows with no undefined states
- No silent fallbacks
- Reliable IndexedDB persistence with schema versioning
- Cross-tab consistency for session and critical shared state
- Testable architecture for Node 18-compatible frontend testing
- Future backend-readiness through repository abstractions

---

## 3. Technical Scope and Boundaries

### 3.1 In Scope

- Angular SPA
- Angular Router
- Reactive Forms and Form Controls
- IndexedDB persistence
- LocalStorage-backed session/preferences
- PDF and image upload/preview/download
- Watermarked preview/download
- Message Center
- Daily digest generation
- DND delivery suppression
- Job posting and application workflows
- Interview plan management
- Content publishing and moderation
- Integration Simulator
- Audit logs
- Export/import of JSON and CSV
- Encryption and masking
- Offline CAPTCHA
- Lockout and privilege-escalation alerts
- Data dictionary, lineage views, metric definitions, snapshots

### 3.2 Out of Scope

- Real backend APIs
- Real email, SMS, or webhook delivery over a network
- Real server-side RBAC enforcement
- Real cloud file storage
- Real third-party identity providers
- Real SSN verification
- Real multi-device synchronization across machines

### 3.3 Core Principle

All business rules must exist in services. UI components may guide and restrict user actions, but they must not be the source of truth for validation, authorization, state transitions, quota enforcement, or integrity checks.

---

## 4. High-Level Architecture

The system follows a layered offline-first architecture:

```text
Angular UI / Angular Router / Components / Reactive Forms
                         ↓
                Application Services Layer
                         ↓
               Repository / Persistence Layer
                         ↓
              IndexedDB + LocalStorage
```

Supporting runtime modules:

- Auth Runtime
- Session Runtime
- Crypto Service
- Notification Engine
- Digest Generator
- DND Evaluator
- Scheduler / Timer Service
- Integration Simulator Runtime
- Service Worker Interceptor
- Outbound Event Queue
- Audit Logger
- Search / Filter Index Service
- Import/Export Service
- Snapshot / Versioning Service
- Cross-Tab Coordination Service
- Data Dictionary / Lineage Resolver

### Architecture Principles

- IndexedDB is the source of truth for structured operational data
- LocalStorage stores lightweight state only
- UI never writes directly to IndexedDB
- Repositories own persistence access
- Services own rules and workflows
- Runtime modules own scheduling, digesting, crypto, coordination, and integration simulation
- Every critical mutation produces an audit event

---

## 5. Frontend Architecture

### 5.1 Framework and Runtime

- Angular
- TypeScript
- Angular Router
- Angular Reactive Forms
- Browser-only runtime
- English-only UI

### 5.2 Route Areas

Primary route areas:

- `/login`
- `/dashboard`
- `/jobs`
- `/jobs/:jobId`
- `/applications`
- `/applications/:applicationId`
- `/application-packet/:applicationId`
- `/interviews`
- `/message-center`
- `/documents`
- `/content`
- `/governance`
- `/integration`
- `/admin`

### 5.3 Role-Based Workspaces

Each role receives workspace-specific entry points and filtered navigation.

#### Candidate

- application tracking
- Application Packet wizard
- personal documents
- interview schedule view
- message center

#### Employer

- job management
- application review
- interview planning
- document review
- publishing tools

#### HR Coordinator

- job operations
- application routing
- scheduling coordination
- document review
- moderation support
- governance/reporting access

#### Interviewer

- assigned interview schedule
- interview details
- feedback submission
- message center

#### Administrator

- user and role management
- policy/configuration
- sensitive-word management
- audit/governance tools
- integration simulator controls
- import/export

### 5.4 UI Composition

The interface is organized into:

- app shell
- role-aware navigation
- workspace dashboards
- page-level operational views
- drawers, modals, and wizards
- reusable tables, filters, badges, timelines, and steppers
- shared loading, empty, success, and error states

### 5.5 Major UI Components

- job list and job editor
- application pipeline table
- application details workspace
- Application Packet wizard
- interview plan builder
- schedule calendar/list views
- message center inbox and thread panel
- subscription preferences panel
- DND window editor
- digest preview panel
- content editor
- publish scheduler
- moderation review drawer
- document upload manager
- document previewer
- watermark preview overlay
- lineage graph panel
- data dictionary viewer
- metric definition table
- audit log explorer
- integration request console
- queue monitor
- admin policy/config editor

---

## 6. Application Services Layer

All business logic is implemented in frontend services.

### 6.1 AuthService

Responsibilities:

- local username/password registration and login
- password verification using salted hash
- failed-attempt tracking
- lockout enforcement
- offline CAPTCHA challenge flow
- logout
- session restore
- cross-tab session invalidation
- hooks for role-change anomaly detection

### 6.2 SessionService

Responsibilities:

- active session retrieval
- session timeout handling
- remember-session support
- session sync across tabs
- current organization and role context resolution
- default inactivity timeout enforcement of 30 minutes
- remember-session extension to 7 days
- expiresAt recalculation from lastActiveAt plus timeout policy

### 6.3 UserService

Responsibilities:

- user profile CRUD
- role assignment
- organization and department association
- role change workflow enforcement
- privilege-escalation alert creation
- soft-deactivation workflow enforcement
- active-session invalidation for deactivated users

### 6.4 JobService

Responsibilities:

- job posting CRUD
- job ownership enforcement
- job lifecycle transitions
- tag/topic association
- posting schedule support if needed later
- job visibility state
- lineage root registration
- enforce cascading rules when jobs are closed or archived
- allow existing submitted applications to continue processing after job closure while blocking new applications
- prevent new interview scheduling on archived jobs
- optimistic-locking validation using entity version

### 6.5 ApplicationService

Responsibilities:

- application creation
- candidate/job linkage validation
- application lifecycle transitions
- ownership and stage-based ABAC checks
- application progress tracking
- offer handling
- interview and document relationship management
- enforce one application per candidate per job
- reject applications to closed or archived jobs
- reject applications outside the candidate's organization scope
- treat draft removal as delete rather than withdraw
- cancel pending application-linked notifications when an application is withdrawn
- automatically create Job → Application lineage links
- optimistic-locking validation using entity version

### 6.6 ApplicationPacketService

Responsibilities:

- Application Packet wizard orchestration
- required section validation
- draft save/load
- final submission gating
- packet completeness scoring
- required document presence enforcement
- reopen workflow for submitted packets when corrections are required
- reopen reason capture and audit logging
- temporary unlock management after authorized reopen

### 6.7 InterviewPlanService

Responsibilities:

- interview plan CRUD
- stage plan structure
- interviewer assignment
- duration and sequence validation
- preconditions for scheduling

### 6.8 InterviewScheduleService

Responsibilities:

- schedule creation and edits
- overlap detection
- interviewer conflict checks
- candidate conflict checks
- reschedule workflows
- schedule-change alerts
- interview completion state updates
- preserve the same interview record on reschedule with full audit trail
- automatically create Application → Interview lineage links
- optimistic-locking validation using entity version

### 6.9 FeedbackService

Responsibilities:

- interviewer feedback capture
- stage completion validation
- visibility rules
- score/comment persistence
- enforce that candidates never see interviewer scores or internal feedback
- enforce that interviewers see only their own submitted feedback
- enforce that Employers and HR Coordinators can view all interview feedback only after interview completion

### 6.10 MessageCenterService

Responsibilities:

- thread creation
- participant validation
- message send/read state
- read receipts
- event-message linking
- conversation retrieval by role/context
- enforce context-scoped messaging only
- allow Candidate ↔ Employer messaging only for jobs the candidate applied to
- allow Interviewer ↔ Candidate messaging only for assigned interviews or application contexts
- prevent unrestricted cross-organization or global direct messaging

### 6.11 NotificationService

Responsibilities:

- notification creation
- event-type subscription filtering
- per-user preference evaluation
- per-type daily frequency cap enforcement
- read/unread updates
- per-event deduplication using event identity tracking
- route excess legitimate events beyond the daily instant cap into digest-only delivery rather than silently dropping them
- cancel pending notifications tied to withdrawn applications

### 6.12 DigestService

Responsibilities:

- aggregate messageable events into daily digest payloads
- ensure one digest per user per digest window
- suppress duplicate aggregation
- persist digest entries for later delivery/review
- enforce a unique digest identity of userId plus digestDate

### 6.13 DNDService

Responsibilities:

- evaluate whether a user is inside a DND window
- delay instant delivery when blocked by DND
- release delayed items when DND expires
- use local-time evaluation per user preference

### 6.14 DocumentService

Responsibilities:

- file upload validation
- MIME and extension validation
- per-file and per-account quota enforcement
- preview handling
- download authorization
- watermark application on preview/download
- linkage to application or user records
- block deletion of documents linked to submitted or locked application packets unless the packet is first reopened by an authorized role
- automatically create Application → Document lineage links when documents are attached to an application
- quota enforcement with cross-tab safe reservation/finalization flow
- storage-capacity checks before large writes

### 6.15 ContentService

Responsibilities:

- draft posts and short updates
- tagging/topics
- scheduled publishing
- pinning for 7 days
- content status transitions
- visibility control
- HTML sanitization before persistence
- publish authorization enforcement for Employer, HR Coordinator, and Administrator roles only

### 6.16 ModerationService

Responsibilities:

- comment intake
- sensitive-word validation
- link-count validation
- cooldown enforcement
- review drawer queue
- approve/reject decision recording with reasons
- HTML sanitization before persistence
- persisted last-comment timestamp enforcement for 30-second cooldown

### 6.17 IntegrationService

Responsibilities:

- in-app REST-like request console handling
- local endpoint dispatch
- idempotency key validation
- rate limiting
- HMAC signature verification
- callback queue creation
- fixed-window rate limiting at 60 requests per minute per integration
- HMAC verification against active and previous shared secrets during rotation windows
- secret-version tracking on signed integration requests

### 6.18 WebhookQueueService

Responsibilities:

- outbound callback queue persistence
- exponential backoff retry scheduling
- terminal failure marking
- delivery-attempt audit logging
- callback retry scheduling for up to 5 attempts over 15 minutes

### 6.19 AuditService

Responsibilities:

- immutable append-only audit log creation
- actor attribution
- action normalization
- date-range and actor search helpers
- tamper-evident hash-chain generation using previousHash
- integrity verification helpers when audit logs are read

### 6.20 GovernanceService

Responsibilities:

- data dictionary retrieval
- lineage path resolution
- metric definition management
- dataset snapshot creation and listing
- revision query support
- seed and expose metric definitions as static governance metadata
- create metadata-only snapshots without duplicating document blobs

### 6.21 ImportExportService

Responsibilities:

- JSON export
- CSV export for supported tabular data
- import validation
- preview-before-apply
- overwrite/merge rules
- backup portability handling
- exclude audit logs from import
- invalidate or re-evaluate active sessions when imported user data affects the logged-in user

### 6.22 CryptoService

Responsibilities:

- PBKDF2 password hashing
- AES-GCM encrypt/decrypt helpers
- IV generation/storage
- masking helpers
- sensitive field handling
- derive encryption keys from the authenticated user's password material
- support re-encryption flows on password change
- use an explicitly configured PBKDF2 iteration count appropriate for offline local storage hardening

### 6.23 StorageService

Responsibilities:

- inspect browser storage estimates before large writes
- surface storage pressure warnings beginning at 80% estimated capacity
- provide graceful failure handling when IndexedDB quota is exceeded
- support reservation helpers for large file writes and snapshot creation

### 6.24 SchedulerService

Responsibilities:

- periodic runtime execution every 60 seconds while app is open
- digest generation
- delayed delivery release
- webhook retry processing
- stale pending item cleanup
- startup catch-up for overdue tasks
- offer expiration processing
- content pin expiration processing
- cleanup of pending notifications invalidated by application withdrawal
- single-leader execution enforcement across tabs

### 6.25 SearchService

Responsibilities:

- local filtering/indexing for governance and operational views
- searchable audit logs
- searchable data dictionary
- searchable lineage-linked entities
- filter helpers for date ranges, actors, statuses, and tags

---

## 7. Repository Layer

Repositories abstract all persistence operations and isolate IndexedDB details from services.

### Core Repositories

- UserRepository
- SessionRepository
- JobRepository
- ApplicationRepository
- ApplicationPacketRepository
- InterviewPlanRepository
- InterviewRepository
- FeedbackRepository
- DocumentRepository
- ThreadRepository
- MessageRepository
- NotificationRepository
- DigestRepository
- ContentRepository
- CommentRepository
- ModerationRepository
- AuditLogRepository
- MetricDefinitionRepository
- SnapshotRepository
- DataDictionaryRepository
- QueueRepository
- ConfigRepository
- StorageReservationRepository

### Repository Rules

- services must never manipulate raw IndexedDB directly
- repositories return domain-shaped records
- repository writes must be atomic where multi-entity consistency matters
- schema version migrations must be centralized

---

## 8. Data Persistence Design

### 8.1 IndexedDB Stores

Planned stores:

- users
- sessions
- userDeactivationEvents
- jobs
- jobTags
- applications
- applicationPackets
- packetSections
- interviewPlans
- interviews
- interviewFeedback
- documents
- documentQuotaUsage
- threads
- messages
- notifications
- notificationPreferences
- digests
- delayedDeliveries
- notificationEvents
- notificationCancellations
- contentPosts
- contentComments
- moderationCases
- sensitiveWords
- integrationRequests
- idempotencyKeys
- rateLimitBuckets
- webhookQueue
- activeIntegrationSecrets
- auditLogs
- auditIntegrityChecks
- metricDefinitions
- dataDictionaryEntries
- lineageLinks
- datasetSnapshots
- exportJobs
- storageReservations
- appConfig

### 8.2 LocalStorage

Used only for:

- lightweight session metadata
- theme/layout preferences
- non-sensitive UI settings
- last-selected workspace filters if desired

### 8.3 Persistence Principles

- IndexedDB stores all durable operational data
- LocalStorage must not contain sensitive documents, secrets, or authoritative business records
- repositories are the only layer that interacts with IndexedDB directly
- schema migrations are explicit and versioned

---

## 9. Core Domain Models

### 9.1 User

Fields:

- id
- username
- passwordHash
- passwordSalt
- roles[]
- organizationId
- departmentId
- displayName
- failedAttempts
- captchaRequiredAfterFailures
- lockoutUntil
- lastCommentAt
- deactivatedAt
- createdAt
- updatedAt
- version

### 9.2 Session

Fields:

- id
- userId
- createdAt
- expiresAt
- lastActiveAt
- rememberSession
- timeoutPolicy
- isLocked
- version

Notes:

- expiresAt is derived from lastActiveAt plus the active timeout policy
- default inactivity timeout is 30 minutes
- rememberSession extends the timeout horizon to 7 days

### 9.3 Job

Fields:

- id
- organizationId
- ownerUserId
- title
- description
- tags[]
- topics[]
- status
- createdAt
- updatedAt
- version

States:

- draft
- active
- closed
- archived

### 9.4 Application

Fields:

- id
- jobId
- candidateId
- organizationId
- stage
- status
- offerExpiresAt
- submittedAt
- updatedAt
- version

Notes:

- stage represents the lifecycle position of the application
- status represents the record condition, such as active, withdrawn, deleted, expired, accepted, rejected, or archived

Stages:

- draft
- submitted
- under_review
- interview_scheduled
- interview_completed
- offer_extended

Statuses:

- active
- accepted
- rejected
- withdrawn
- expired
- deleted
- archived

### 9.5 ApplicationPacket

Fields:

- id
- applicationId
- status
- reopenReason
- reopenedAt
- reopenedBy
- completenessScore
- submittedAt
- updatedAt
- version

States:

- draft
- in_progress
- submitted
- reopened
- locked

### 9.6 PacketSection

Fields:

- id
- applicationPacketId
- sectionKey
- payload
- isComplete
- updatedAt
- version

### 9.7 InterviewPlan

Fields:

- id
- jobId
- organizationId
- stages[]
- createdBy
- updatedAt
- version

### 9.8 Interview

Fields:

- id
- applicationId
- interviewPlanId
- organizationId
- interviewerId
- startTime
- endTime
- status
- rescheduledAt
- rescheduledBy
- createdAt
- updatedAt
- version

States:

- scheduled
- completed
- canceled

### 9.9 InterviewFeedback

Fields:

- id
- interviewId
- organizationId
- interviewerId
- score
- notes
- submittedAt
- version

### 9.10 Document

Fields:

- id
- ownerUserId
- organizationId
- applicationId
- fileName
- mimeType
- extension
- sizeBytes
- encryptedBlob
- status
- createdAt
- updatedAt
- version

Statuses:

- uploaded
- reviewed
- rejected
- archived

### 9.11 Thread

Fields:

- id
- organizationId
- contextType
- contextId
- participantIds[]
- createdAt
- updatedAt
- version

### 9.12 Message

Fields:

- id
- organizationId
- threadId
- senderId
- content
- isSensitive
- createdAt
- readBy[]
- version

### 9.13 Notification

Fields:

- id
- organizationId
- userId
- type
- referenceType
- referenceId
- eventId
- message
- createdAt
- isRead
- deliveryMode
- isCanceled
- version

### 9.14 NotificationPreference

Fields:

- id
- userId
- organizationId
- eventType
- instantEnabled
- digestEnabled
- dndStart
- dndEnd
- version

### 9.15 Digest

Fields:

- id
- userId
- organizationId
- digestDate
- itemIds[]
- createdAt
- deliveredAt
- uniqueKey
- version

### 9.16 ContentPost

Fields:

- id
- organizationId
- authorId
- title
- body
- tags[]
- topics[]
- status
- scheduledPublishAt
- pinnedUntil
- createdAt
- updatedAt
- version

States:

- draft
- scheduled
- published
- archived

### 9.17 Comment

Fields:

- id
- organizationId
- postId
- authorId
- content
- status
- moderationReason
- createdAt
- version

States:

- pending
- approved
- rejected

### 9.18 ModerationCase

Fields:

- id
- organizationId
- commentId
- detectedIssues[]
- decision
- decisionReason
- decidedBy
- decidedAt
- version

### 9.19 IntegrationRequest

Fields:

- id
- organizationId
- method
- path
- headers
- body
- idempotencyKey
- signature
- secretVersion
- integrationKey
- createdAt
- responseSnapshot
- version

### 9.20 WebhookQueueItem

Fields:

- id
- organizationId
- targetName
- payload
- retryCount
- nextRetryAt
- status
- createdAt
- updatedAt
- version

States:

- pending
- processing
- delivered
- failed

### 9.21 AuditLog

Fields:

- id
- actorId
- action
- entityType
- entityId
- timestamp
- metadata
- previousHash
- entryHash

### 9.22 MetricDefinition

Fields:

- id
- key
- label
- formulaDescription
- seededBySystem
- createdAt
- updatedAt

### 9.23 DataDictionaryEntry

Fields:

- id
- entityType
- fieldName
- description
- dataType
- sensitivity
- updatedAt
- seededBySystem

### 9.24 LineageLink

Fields:

- id
- fromEntityType
- fromEntityId
- toEntityType
- toEntityId

### 9.25 DatasetSnapshot

Fields:

- id
- label
- organizationId
- createdAt
- createdBy
- manifest
- queryNotes

Notes:

- snapshots are metadata-only manifests and must not duplicate stored document blobs
- snapshot retention is capped per organization

---

## 10. State Machines

### 10.1 Job State Machine

- draft → active
- active → closed
- closed → archived
- draft → archived

Invalid transitions are rejected.

### 10.2 Application State Machine

Stage transitions:

- draft → submitted
- submitted → under_review
- under_review → interview_scheduled
- interview_scheduled → interview_completed
- interview_completed → offer_extended

Status transitions:

- active → accepted
- active → rejected
- active → withdrawn
- active → expired
- active → archived
- draft → deleted

Additional rules:

- no skipped stage transitions allowed unless explicitly defined by service rules
- withdrawal is allowed only after submission and before acceptance
- offer expiration transitions an active offer to expired when offerExpiresAt is reached
- pending notifications tied to a withdrawn application are canceled

### 10.3 Application Packet State Machine

- draft → in_progress
- in_progress → submitted
- submitted → reopened
- reopened → in_progress
- submitted → locked
- reopened → locked

Rules:

- only HR Coordinators and Employers may trigger submitted → reopened
- reopen requires a reason and audit log entry
- locked packets cannot be edited

### 10.4 Interview State Machine

- scheduled → completed
- scheduled → canceled
- scheduled → scheduled for reschedule events with updated timing and audit trail

### 10.5 Content Post State Machine

- draft → scheduled
- draft → published
- scheduled → published
- published → archived

### 10.6 Comment Moderation State Machine

- pending → approved
- pending → rejected

---

## 11. Authorization Model

### 11.1 RBAC

Roles define coarse permissions:

- Candidate
- Employer
- HR Coordinator
- Interviewer
- Administrator

### 11.2 ABAC

Actions are further constrained by:

- organization
- department
- job ownership
- application stage
- document status
- assignment relationships

### 11.3 Authorization Rules

Examples:

- Candidates may only view and manage their own applications and documents
- Employers may only manage jobs they own or are allowed to manage by organization scope
- HR Coordinators may operate within assigned organization/department boundaries
- Interviewers may only access assigned interviews and related allowed materials
- Administrators may manage roles, policies, and governance features
- Candidates may create only one application per job and only within allowed organization scope
- Content publishing is allowed only for Employers, HR Coordinators, and Administrators
- Candidate ↔ Employer messaging is allowed only when a valid application or job context exists
- Interviewer ↔ Candidate messaging is allowed only when an assignment relationship exists

All read and write paths must enforce authorization in services.

---

## 12. Authentication and Security Design

### 12.1 Authentication Model

- local-only username/password
- no external identity provider
- no backend token issuance
- session restored locally

### 12.2 Password Handling

- passwords hashed with PBKDF2 via Web Crypto
- per-user salt
- verification performed locally
- PBKDF2 iteration count is explicitly configured and stored with the hash metadata for future upgrades

### 12.3 Encryption at Rest

Sensitive fields are encrypted with AES-GCM before persistence.

Sensitive data includes at minimum:

- private document blobs
- sensitive personal fields
- message content if designated sensitive
- masked identifiers

Key strategy:

- encryption keys are derived from authenticated user password material through Web Crypto
- password change workflows must re-encrypt the affected sensitive data
- this remains local-only protection and is intended for integrity simulation rather than true at-rest secrecy against a device owner

### 12.4 Lockout Rules

- CAPTCHA is required after 3 failed attempts
- 5 failed attempts triggers 15-minute lockout
- failed attempt counts are persisted
- lockout survives reload

### 12.5 Offline CAPTCHA

- locally generated math challenge
- required after 3 failed login attempts
- enforced before the 4th and 5th attempts can continue
- does not reset failed-attempt counts by itself

### 12.6 Privilege-Escalation Detection

Any role change occurring outside the allowed Admin workflow is treated as suspicious.

Result:

- audit log entry
- alert record
- optional admin-facing flag in governance view

Note:

- because the application is fully client-side, privilege-escalation detection is tamper-evident workflow logic rather than a guarantee against direct local database manipulation

### 12.7 Security Limitation

Because the system is a pure offline frontend SPA, authentication, encryption, audit immutability, and RBAC are local-only protections and not equivalent to server-enforced security. They still must be implemented consistently for internal integrity and QA compliance, but they must be described as integrity-simulation controls rather than true adversarial security.

---

## 13. Document Management Design

### 13.1 Supported Types

- PDF
- image files

### 13.2 Validation Rules

- MIME type must match file extension
- max 25 MB per file
- max 200 MB total per account
- invalid files rejected before persistence

### 13.3 Access Control

Document access depends on:

- role
- ownership
- associated record
- document status
- linked application stage and status

When these conflict, the more restrictive rule wins.

### 13.4 Preview and Download

- preview available for authorized users
- download available only when allowed by role and record status
- original file remains unchanged in storage

### 13.5 Watermarking

Watermarking is applied dynamically on preview/download.

Watermark content:

- viewer name or actor context
- timestamp

Watermark is not baked into the stored original file.

Implementation note:

- PDF watermarking requires runtime browser-side PDF manipulation
- image watermarking requires browser-side canvas composition
- malformed files must fail gracefully with surfaced errors rather than silent preview/download failure

---

## 14. Messaging, Notifications, Digests, and DND

### 14.1 Event Types

At minimum:

- application received
- interview confirmed
- schedule changed
- offer expiring
- document reviewed

### 14.2 Subscription Toggles

Users may configure per-event preferences:

- instant delivery enabled/disabled
- digest inclusion enabled/disabled

### 14.3 Read Receipts

Messages record which participants have read them.

### 14.4 Daily Digests

- aggregated once per day
- built from digest-eligible events
- stored locally
- delivered when outside DND
- unique digest identity is userId plus digestDate

### 14.5 DND Windows

Example:

- 9:00 PM to 7:00 AM local time

Rules:

- instant delivery is delayed, not discarded
- digest delivery is also delayed if it falls in DND
- queued delayed items are released after DND ends

### 14.6 Notification Limits

- maximum 3 instant notifications per type per day per user
- duplicates prevented through event tracking
- legitimate events beyond the instant cap are retained for digest delivery when digest is enabled

---

## 15. Content Publishing and Moderation

### 15.1 Publishing Features

Authorized users may:

- draft posts and short updates
- tag by topic
- schedule publish date/time
- pin priority announcements for 7 days

Authorized publishing roles:

- Employer
- HR Coordinator
- Administrator

### 15.2 Comment Moderation

Comments are moderated through a Review Drawer.

Moderators can:

- approve
- reject with reason

### 15.3 Local Anti-Spam Rules

- blocklisted term detection
- max 3 links per comment
- 30-second posting cooldown per user

Rules are enforced in services, not just UI, and cooldown checks use persisted timestamps rather than view-only timers.

---

## 16. Integration Simulator

### 16.1 Purpose

Simulate API and webhook behavior locally even though the system is offline.

### 16.2 Components

- in-app request console
- Service Worker fetch interceptor
- outbound callback queue

### 16.3 Features

- REST-like request handling
- idempotency keys with 24-hour retention
- fixed-window rate limiting: 60 requests per minute per integration
- HMAC signature verification with rotating shared secrets
- callback retry with exponential backoff
- maximum 5 attempts over 15 minutes

HMAC rotation rules:

- each signed request records a secretVersion
- one active secret and one immediately previous secret may validate during the rotation grace window

### 16.4 Queue Rules

Outbound callbacks are written to a persistent queue and retried by SchedulerService until:

- delivered
- max attempts reached and marked failed

---

## 17. Audit Logging and Governance

### 17.1 Audit Log Rules

Audit logs are immutable and append-only.

Critical actions logged include:

- login/logout
- failed login/lockout
- role changes
- job CRUD
- application lifecycle transitions
- interview scheduling/rescheduling
- document upload/review/download
- moderation decisions
- integration requests
- queue retry/failure events
- import/export actions

Tamper evidence:

- each audit entry stores previousHash and entryHash to form a hash chain
- integrity checks run when audit views are loaded

### 17.2 Audit Search

Audit logs must be searchable by:

- date range in MM/DD/YYYY format
- actor

### 17.3 Data Dictionary

Data dictionary exposes:

- entities
- fields
- field meanings
- data type
- sensitivity level

### 17.4 Lineage Views

Lineage relationships must support at minimum:

- Job → Application → Interview → Document

### 17.5 Metric Definitions

Metric definitions are stored locally as seeded governance metadata, including examples such as:

- views
- favorites
- inquiry conversion

They are not user-created runtime formulas in the initial implementation.

### 17.6 Dataset Snapshots

Snapshots store traceable dataset/version states with query notes and manifest data.

Snapshot rules:

- snapshots are metadata-only manifests
- document blobs are excluded from snapshot duplication
- retention is capped per organization

---

## 18. Import / Export Design

### 18.1 Export

Supported formats:

- JSON
- CSV for compatible structured views

Use cases:

- backup
- device-to-device transfer

### 18.2 Import

Import flow:

1. select file
2. validate schema and structure
3. preview result
4. apply chosen strategy

Import exclusions and safeguards:

- audit logs are not importable
- imports affecting the active user must trigger active-session revalidation

### 18.3 Import Strategies

- overwrite
- merge by ID where supported

No silent overwrite allowed.

---

## 19. Scheduler and Background Processing

### 19.1 Runtime Interval

Runs every 60 seconds while the app is open.

### 19.2 Responsibilities

- build daily digests when due
- release delayed notifications after DND
- process webhook retry queue
- cleanup expired rate-limit buckets/idempotency entries if needed
- reconcile overdue tasks on startup
- process offer expiration
- expire content pins after 7 days
- cancel stale pending notifications tied to withdrawn applications

### 19.3 Startup Catch-Up

On startup, overdue scheduled work is processed so important delayed actions are not lost.

---

## 20. Cross-Tab Consistency

### 20.1 Mechanism

- BroadcastChannel
- last-write-wins for lightweight UI/session sync
- LocalStorage-backed leader-election lock with heartbeat for single active scheduler tab

### 20.2 Synced Concerns

- logout/session invalidation
- role change alerts
- selected workspace context if needed
- notification state refresh

Only one tab actively processes scheduler queue work through mandatory leader-election logic.

---

## 21. Error Handling Strategy

- all important failures return structured service errors
- UI shows clear inline or toast feedback
- no silent skips
- invalid operations blocked in services
- empty/loading/error/success states required on key pages
- import/export, upload, and integration flows must surface concrete errors
- storage quota exhaustion must surface a specific recoverable error path

---

## 22. Testing Strategy

### 22.1 Unit Tests

Focus areas:

- password hashing and verification
- lockout and CAPTCHA thresholds
- state transitions
- ABAC and RBAC checks
- file quota validation
- notification frequency caps
- DND evaluation
- digest aggregation
- idempotency and rate-limiting logic
- webhook retry scheduling
- watermark application helpers

### 22.2 Component Tests

Focus areas:

- login flow
- job form validation
- Application Packet wizard steps
- schedule conflict feedback
- message center rendering
- digest/DND settings UI
- moderation drawer behavior
- document upload states
- governance viewers

### 22.3 End-to-End Flows

- login / lockout / CAPTCHA
- create and publish a job
- submit application and packet
- schedule and reschedule interview
- send/read messages
- receive notifications and digest behavior
- upload/review/download document
- content publish and moderated comment review
- integration simulator request and webhook retry
- export and restore data

---

## 23. Implementation Constraints

- pure frontend only
- fully offline
- no real backend calls
- no UI-only validation for business rules
- all persistence through repositories
- all business rules through services
- Angular Router must drive SPA navigation
- Reactive Forms must handle complex form validation
- no placeholder-only logic for core workflows

---

## 24. Future Integration Readiness

Although offline-first is the current runtime model, the design remains backend-ready through:

- repository abstractions
- service-level business logic independent of storage implementation
- explicit integration simulation boundaries
- clear domain models and workflows

This allows future replacement of local repositories with API-backed adapters without redesigning core business rules.