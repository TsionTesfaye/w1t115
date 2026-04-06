# TalentBridge — Design Q&A

Answers to questions that came up during design review and implementation.

---

## Storage

**Q: Why IndexedDB instead of localStorage for domain data?**

LocalStorage is synchronous, limited to ~5-10 MB, and stores only strings. IndexedDB is async, supports structured data and binary blobs (needed for encrypted documents), has compound indexes for efficient queries, and has no practical size limit beyond available disk space.

**Q: Why LocalStorage at all?**

Two narrow uses only: (1) the active session ID — a single string that must survive a page refresh and be readable synchronously before Angular boots — and (2) scheduler leader-election keys (`tb_scheduler_leader`, `tb_scheduler_heartbeat`) which need to be visible across tabs without opening an IndexedDB connection.

**Q: What happens if IndexedDB is unavailable?**

The `Database` class constructor throws immediately. The app shows an error state explaining that offline storage is required. This is a hard dependency; there is no fallback.

---

## Authentication

**Q: Why PBKDF2 and not bcrypt or Argon2?**

`bcrypt` and `Argon2` are not available in the Web Crypto API. PBKDF2-SHA256 is available natively via `crypto.subtle.deriveBits`. 100,000 iterations on modern hardware takes ~200-400ms — acceptable for login, significant enough to slow brute-force attacks.

**Q: Why store `pbkdf2Iterations` on the User record?**

So the iteration count can be increased over time for new registrations without breaking existing users. When a user logs in successfully, the service can re-hash with the new count and update `pbkdf2Iterations`.

**Q: Is the password ever in plaintext anywhere?**

Only in the `login()` and `register()` method parameters for the duration of the function call. It is hashed before any async boundary that could leave the call frame. It is never stored in any signal, field, or IndexedDB record.

**Q: Why is CAPTCHA threshold (3) different from lockout threshold (5)?**

A human making honest mistakes should not be locked out. The CAPTCHA acts as a softer gate — verifying the user is human — before the harder lockout kicks in. Three failures is a reasonable signal of either attack or significant user confusion.

---

## State Machines

**Q: Why are state machines implemented as ReadonlyMap instead of a class hierarchy?**

A flat map of `from → Set<to>` is the simplest representation that can be checked in O(1). A class hierarchy (or discriminated union) would be more expressive but adds indirection with no benefit for a transition table. The `assertTransition()` function is six lines.

**Q: What if a status change needs to be allowed from multiple sources?**

The `Set<T>` value in the map lists all valid `to` states from a given `from` state. Any state in that set is a valid target. If a state can be reached from multiple predecessors, each predecessor has its own entry with the full set of valid targets.

**Q: What happens to in-flight operations when a state machine rejects a transition?**

`assertTransition()` throws `StateMachineError` before any IndexedDB write is attempted. Nothing is written. The caller (service method) propagates the error. The UI catches it at the toast level.

---

## Optimistic Locking

**Q: Why optimistic locking instead of pessimistic?**

Pessimistic locking requires a "lock owner" concept and a way to release locks if a tab crashes. In a single-user offline app with cross-tab sync, optimistic locking is simpler and sufficient. Collisions are rare; when they occur the user gets a clear `OptimisticLockError` and can retry.

**Q: How does `updateWithLock` work?**

It opens a `readwrite` transaction on the store, reads the current record, checks that `current.version === expected.version`, increments the version, writes the updated record, and commits. All within a single IDB transaction, so it is atomic.

---

## Cross-Tab Behavior

**Q: How does logout in one tab affect other tabs?**

`SessionService.logout()` posts a `LOGOUT` message on the `SESSION` BroadcastChannel. All other tabs receive this, call `clearSession()` locally, and navigate to `/login`.

**Q: What prevents the scheduler from running in multiple tabs simultaneously?**

Before each tick, `SchedulerService` checks: (1) Is there already a leader? (2) Is the leader's heartbeat fresh (within 30 seconds)? If both are true and this tab is not the leader, it skips. If the heartbeat is stale (the previous leader tab was closed), this tab claims leadership. Leadership is recorded in LocalStorage so all tabs can see it.

**Q: What if two tabs race to claim leadership simultaneously?**

LocalStorage writes are not atomic across tabs in all browsers. However, the worst case is that both tabs run one scheduler tick before the next heartbeat check resolves the conflict. Scheduler jobs are idempotent (e.g., expiring an already-expired offer is a no-op), so duplicate execution is safe.

---

## Audit Log

**Q: What does the hash chain actually protect against?**

It detects modification of any historical audit entry or deletion of entries from the middle of the chain. To tamper with entry N, an attacker would have to recompute all subsequent hashes — computationally feasible in a client-side context, but it leaves a clear trail if `verifyIntegrity()` is called.

**Q: Why is `previousHash` stored on each entry instead of just a root hash?**

A root hash (Merkle root) requires reading all entries to recompute. Walking the chain with inline `previousHash` allows incremental verification and immediate detection of the tampered entry.

---

## Documents

**Q: Why encrypt documents at rest in IndexedDB?**

IndexedDB data is stored in plaintext on disk and readable by other browser extensions or OS-level access. Encrypting with an AES-GCM key derived from the user's password means the document is unreadable without knowing the user's password, even with raw disk access.

**Q: What is `encryptionKeySalt`?**

A separate PBKDF2 salt stored on the User record. The encryption key is derived independently from the authentication hash: `deriveEncryptionKey(password, encryptionKeySalt)`. This means changing the authentication salt (e.g., password reset) does not automatically re-encrypt all documents — which is a deliberate trade-off to avoid requiring full document re-encryption on every password change.

---

## Notifications

**Q: Why route overflow notifications to a digest instead of dropping them?**

Dropping would silently lose information. Digest delivery ensures the user eventually sees all events, just consolidated. The max-3-per-day limit prevents notification fatigue from automated events (e.g., a flurry of application status changes).

**Q: How does DND interact with digest delivery?**

DND suppresses instant delivery; it does not suppress digest delivery. Digests are generated daily regardless of DND windows. Delayed delivery items are released after the DND window ends.

---

## Integration

**Q: Why is rate limiting implemented in the browser?**

The integration gateway is a simulated external API. The rate limiter enforces realistic behavior for integration testing purposes. In a production deployment, rate limiting would be enforced server-side; the client-side implementation here demonstrates the logic.

**Q: What is the rotation grace period?**

When an integration secret is rotated, the old secret remains valid for one rotation cycle. `IntegrationService.verifyHmac()` checks the signature against the current active secret first, then falls back to the most recently deactivated secret. This allows in-flight requests signed with the old secret to complete without failing.

---

## Testing

**Q: Why Vitest instead of Karma/Jasmine?**

Vitest is significantly faster (no browser launch overhead for unit tests), has better TypeScript integration, and supports ESM natively. Angular CLI 21 supports Vitest via `@analogjs/vitest-angular`.

**Q: Why does app.spec.ts only test `expect(App).toBeDefined()`?**

The full `App` component triggers `SchedulerService.start()` on init, which calls `DNDService.releaseExpiredDelays()`, which opens an IndexedDB connection. IndexedDB is not available in the Vitest/Node environment. The minimal test confirms the component class is importable and defined without bootstrapping it — which is sufficient as a smoke test. Full integration tests belong in a real browser environment.
