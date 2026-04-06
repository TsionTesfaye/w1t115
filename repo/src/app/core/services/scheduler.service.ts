import { Injectable, OnDestroy } from '@angular/core';
import { SCHEDULER_CONSTANTS, BROADCAST_CHANNELS, NOTIFICATION_CONSTANTS } from '../constants';
import { ApplicationService } from './application.service';
import { DigestService } from './digest.service';
import { DNDService } from './dnd.service';
import { ContentService } from './content.service';
import { IntegrationService } from './integration.service';
import { ApplicationRepository, UserRepository } from '../repositories';
import { ApplicationStatus, ApplicationStage } from '../enums';
import { now } from '../utils/id';

// ─── Election message types ───────────────────────────────────────────────────
//
// All messages flow on BROADCAST_CHANNELS.SCHEDULER.
//
//   LEADER_CLAIM    — "I'm attempting to claim leadership"
//                     (sent by a candidate tab as it writes its claim to localStorage)
//   LEADER_ANNOUNCE — "I am the leader" (sent by the winning tab after verifying its claim,
//                     and periodically alongside heartbeats so late-joining tabs know who leads)
//   LEADER_HEARTBEAT— "I'm still alive" (sent every LEADER_HEARTBEAT_MS by the leader)
//   LEADER_RESIGNED — "I'm stepping down immediately"
//                     (sent when the leader tab closes; followers re-elect right away)

const SCHEDULER_MSG = {
  LEADER_CLAIM: 'leader_claim',
  LEADER_ANNOUNCE: 'leader_announce',
  LEADER_HEARTBEAT: 'leader_heartbeat',
  LEADER_RESIGNED: 'leader_resigned',
} as const;

type SchedulerMsg = typeof SCHEDULER_MSG[keyof typeof SCHEDULER_MSG];

interface ElectionPayload { tabId: string }

// ─── Leader state machine ─────────────────────────────────────────────────────
//
//   follower  ──jitter+claim──▶  candidate  ──verified──▶  leader
//      ▲                              │ outrace               │
//      │                              ▼                       │
//      └──────── receive LEADER_ANNOUNCE ◀──────── resigned ──┘

type LeaderState = 'follower' | 'candidate' | 'leader';

@Injectable({ providedIn: 'root' })
export class SchedulerService implements OnDestroy {
  private state: LeaderState = 'follower';
  private readonly tabId: string = crypto.randomUUID();

  // Timers
  private tickIntervalId: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private watchdogTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private electionTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private verifyClaimTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // BroadcastChannel for election signaling
  private channel: BroadcastChannel | null = null;

  // Track the last heartbeat received from whichever tab is currently leader
  private lastHeartbeatAt = 0;

  // Whether start() has been called
  private running = false;

  // Visibility listener reference (stored to allow removal on stop)
  private readonly onVisibilityChange = () => this.handleVisibilityChange();

  constructor(
    private readonly applicationService: ApplicationService,
    private readonly digestService: DigestService,
    private readonly dndService: DNDService,
    private readonly contentService: ContentService,
    private readonly integrationService: IntegrationService,
    private readonly appRepo: ApplicationRepository,
    private readonly userRepo: UserRepository,
  ) {}

  // ─── Public lifecycle ───────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(BROADCAST_CHANNELS.SCHEDULER);
      this.channel.onmessage = (ev: MessageEvent<{ type: SchedulerMsg; payload: ElectionPayload }>) => {
        this.handleChannelMessage(ev.data.type, ev.data.payload?.tabId);
      };
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    // Kick off initial election after a random jitter.
    // The jitter prevents every tab that opens at the same time (e.g., session
    // restore) from writing their claim to localStorage simultaneously.
    const jitter = Math.random() * SCHEDULER_CONSTANTS.ELECTION_JITTER_MAX_MS;
    this.electionTimeoutId = setTimeout(() => this.beginElection(), jitter);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.state === 'leader') {
      // Announce resignation so followers can immediately start a new election
      // instead of waiting for the watchdog to time out (up to 15s).
      this.broadcastMsg(SCHEDULER_MSG.LEADER_RESIGNED);
      this.clearLeaderKey();
    }

    this.clearAllTimers();
    this.channel?.close();
    this.channel = null;
    this.state = 'follower';

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  ngOnDestroy(): void { this.stop(); }

  // ─── Leader election ────────────────────────────────────────────────────────

  /**
   * Start an election attempt.
   * Reads localStorage to see if there is already a live leader.
   * If not, writes a claim and waits ELECTION_GRACE_MS to verify it wasn't outrace.
   */
  private beginElection(): void {
    this.electionTimeoutId = null;

    if (!this.running) return;

    // If there is already a live leader that isn't us, become a follower.
    if (this.existingLeaderIsAlive()) {
      this.becomeFollower();
      return;
    }

    // Write our claim to localStorage.
    // Any tab that reads localStorage after this point sees us as the candidate.
    this.state = 'candidate';
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_KEY, this.tabId);
    this.updateHeartbeat(); // write a fresh heartbeat timestamp alongside the claim
    this.broadcastMsg(SCHEDULER_MSG.LEADER_CLAIM);

    // After ELECTION_GRACE_MS, verify our claim is still in localStorage.
    // If another tab wrote its ID after ours (within the same jitter window),
    // its ID would be in LEADER_KEY and we back off.
    this.verifyClaimTimeoutId = setTimeout(() => this.verifyClaim(), SCHEDULER_CONSTANTS.ELECTION_GRACE_MS);
  }

  /**
   * Check if localStorage still contains our tabId.
   * Called ELECTION_GRACE_MS after writing the claim.
   */
  private verifyClaim(): void {
    this.verifyClaimTimeoutId = null;
    if (!this.running || this.state !== 'candidate') return;

    const currentHolder = localStorage.getItem(SCHEDULER_CONSTANTS.LEADER_KEY);
    if (currentHolder === this.tabId) {
      // Our claim survived the grace period — we won the election.
      this.becomeLeader();
    } else {
      // Another tab overwrote our claim — back off to follower.
      this.becomeFollower();
    }
  }

  private becomeLeader(): void {
    this.state = 'leader';
    this.lastHeartbeatAt = Date.now();

    // Announce leadership so other tabs stop their own elections immediately.
    this.broadcastMsg(SCHEDULER_MSG.LEADER_ANNOUNCE);

    // Start the heartbeat interval (must be < LEADER_TIMEOUT_MS so followers
    // don't time us out between beats).
    this.heartbeatIntervalId = setInterval(() => {
      if (this.state !== 'leader') return;
      this.updateHeartbeat();
      this.broadcastMsg(SCHEDULER_MSG.LEADER_HEARTBEAT);
    }, SCHEDULER_CONSTANTS.LEADER_HEARTBEAT_MS);

    // Start the work tick interval.
    this.tickIntervalId = setInterval(() => { void this.tick(); }, SCHEDULER_CONSTANTS.INTERVAL_MS);

    // Run one tick immediately on election win to minimise latency
    // (e.g., if the previous leader died mid-interval, work is behind schedule).
    void this.tick();
  }

  private becomeFollower(): void {
    this.state = 'follower';
    this.lastHeartbeatAt = Date.now(); // reset watchdog clock when we accept a leader

    // Clear any leader-specific timers.
    if (this.tickIntervalId) { clearInterval(this.tickIntervalId); this.tickIntervalId = null; }
    if (this.heartbeatIntervalId) { clearInterval(this.heartbeatIntervalId); this.heartbeatIntervalId = null; }

    // Start follower watchdog: if we don't see a heartbeat within LEADER_TIMEOUT_MS,
    // assume the leader is dead and start a new election.
    this.resetWatchdog();
  }

  // ─── Channel message handling ───────────────────────────────────────────────

  private handleChannelMessage(type: SchedulerMsg, senderTabId: string | undefined): void {
    if (senderTabId === this.tabId) return; // ignore own messages (belt-and-suspenders)

    switch (type) {
      case SCHEDULER_MSG.LEADER_ANNOUNCE:
      case SCHEDULER_MSG.LEADER_HEARTBEAT:
        // Another tab is (or remains) the leader.
        this.lastHeartbeatAt = Date.now();
        this.resetWatchdog();

        // If we were mid-election (candidate), back off: the announcement means
        // another tab already verified its claim.
        if (this.state === 'candidate') {
          if (this.verifyClaimTimeoutId) { clearTimeout(this.verifyClaimTimeoutId); this.verifyClaimTimeoutId = null; }
          this.becomeFollower();
        }
        // If we somehow ended up as dual-leader (shouldn't happen after this fix),
        // yield to the tab that announced first.
        if (this.state === 'leader') {
          const storedLeader = localStorage.getItem(SCHEDULER_CONSTANTS.LEADER_KEY);
          if (storedLeader && storedLeader !== this.tabId) {
            this.yieldLeadership();
          }
        }
        break;

      case SCHEDULER_MSG.LEADER_CLAIM:
        // Another tab is attempting to claim leadership.
        if (this.state === 'leader') {
          // We are the current leader — re-announce to prevent the challenger
          // from winning the election.
          this.broadcastMsg(SCHEDULER_MSG.LEADER_ANNOUNCE);
        }
        break;

      case SCHEDULER_MSG.LEADER_RESIGNED:
        // The current leader stepped down. Start an election immediately
        // (with a small jitter to prevent a thundering herd).
        this.lastHeartbeatAt = 0;
        if (this.watchdogTimeoutId) { clearTimeout(this.watchdogTimeoutId); this.watchdogTimeoutId = null; }
        if (this.state !== 'leader') {
          const jitter = Math.random() * SCHEDULER_CONSTANTS.ELECTION_JITTER_MAX_MS;
          this.electionTimeoutId = setTimeout(() => this.beginElection(), jitter);
        }
        break;
    }
  }

  // ─── Follower watchdog ──────────────────────────────────────────────────────

  /**
   * Reset (or start) the watchdog timer.
   * If the leader does not send a heartbeat within LEADER_TIMEOUT_MS,
   * the follower assumes the leader is dead and starts a new election.
   */
  private resetWatchdog(): void {
    if (this.watchdogTimeoutId) { clearTimeout(this.watchdogTimeoutId); this.watchdogTimeoutId = null; }
    if (this.state === 'leader') return; // leaders don't need a watchdog

    this.watchdogTimeoutId = setTimeout(() => {
      this.watchdogTimeoutId = null;
      if (this.state === 'leader') return;
      // No heartbeat received within the timeout window.
      const sinceLastBeat = Date.now() - this.lastHeartbeatAt;
      if (sinceLastBeat >= SCHEDULER_CONSTANTS.LEADER_TIMEOUT_MS) {
        const jitter = Math.random() * SCHEDULER_CONSTANTS.ELECTION_JITTER_MAX_MS;
        this.electionTimeoutId = setTimeout(() => this.beginElection(), jitter);
      } else {
        // A heartbeat arrived recently — reset the watchdog with the remaining budget.
        this.watchdogTimeoutId = setTimeout(() => {
          if (this.state !== 'leader') {
            const j = Math.random() * SCHEDULER_CONSTANTS.ELECTION_JITTER_MAX_MS;
            this.electionTimeoutId = setTimeout(() => this.beginElection(), j);
          }
        }, SCHEDULER_CONSTANTS.LEADER_TIMEOUT_MS - sinceLastBeat);
      }
    }, SCHEDULER_CONSTANTS.LEADER_TIMEOUT_MS);
  }

  // ─── Visibility change ──────────────────────────────────────────────────────

  /**
   * Called when the tab transitions from hidden → visible.
   *
   * Background tabs can be throttled by the browser for extended periods.
   * When the tab returns to foreground:
   * - If we were leader: verify our heartbeat in localStorage is recent; if it was
   *   overwritten by another tab, yield leadership.
   * - If we were follower: check whether the leader is still alive; if not, elect.
   */
  private handleVisibilityChange(): void {
    if (typeof document === 'undefined' || document.hidden) return;

    if (this.state === 'leader') {
      const storedLeader = localStorage.getItem(SCHEDULER_CONSTANTS.LEADER_KEY);
      if (storedLeader && storedLeader !== this.tabId) {
        // Another tab claimed leadership while we were frozen.
        this.yieldLeadership();
        return;
      }
      // Re-announce and update heartbeat so followers don't time us out.
      this.updateHeartbeat();
      this.broadcastMsg(SCHEDULER_MSG.LEADER_ANNOUNCE);
    } else {
      // As a follower, check if the leader's heartbeat is still fresh.
      if (!this.existingLeaderIsAlive()) {
        // Leader has timed out while this tab was hidden — re-elect.
        const jitter = Math.random() * SCHEDULER_CONSTANTS.ELECTION_JITTER_MAX_MS;
        this.electionTimeoutId = setTimeout(() => this.beginElection(), jitter);
      } else {
        this.lastHeartbeatAt = Date.now();
        this.resetWatchdog();
      }
    }
  }

  // ─── LocalStorage helpers ───────────────────────────────────────────────────

  private existingLeaderIsAlive(): boolean {
    const cur = localStorage.getItem(SCHEDULER_CONSTANTS.LEADER_KEY);
    const hbStr = localStorage.getItem(SCHEDULER_CONSTANTS.LEADER_HEARTBEAT_KEY);
    if (!cur || !hbStr) return false;
    if (cur === this.tabId) return false; // we are the stored leader (bootstrap case)
    const age = Date.now() - parseInt(hbStr, 10);
    return age < SCHEDULER_CONSTANTS.LEADER_TIMEOUT_MS;
  }

  private updateHeartbeat(): void {
    localStorage.setItem(SCHEDULER_CONSTANTS.LEADER_HEARTBEAT_KEY, Date.now().toString());
  }

  private clearLeaderKey(): void {
    if (localStorage.getItem(SCHEDULER_CONSTANTS.LEADER_KEY) === this.tabId) {
      localStorage.removeItem(SCHEDULER_CONSTANTS.LEADER_KEY);
      localStorage.removeItem(SCHEDULER_CONSTANTS.LEADER_HEARTBEAT_KEY);
    }
  }

  private yieldLeadership(): void {
    if (this.tickIntervalId) { clearInterval(this.tickIntervalId); this.tickIntervalId = null; }
    if (this.heartbeatIntervalId) { clearInterval(this.heartbeatIntervalId); this.heartbeatIntervalId = null; }
    this.state = 'follower';
    this.lastHeartbeatAt = Date.now();
    this.resetWatchdog();
  }

  // ─── BroadcastChannel helper ────────────────────────────────────────────────

  private broadcastMsg(type: SchedulerMsg): void {
    this.channel?.postMessage({ type, payload: { tabId: this.tabId } });
  }

  // ─── Scheduled tasks ────────────────────────────────────────────────────────

  /**
   * The work tick — runs only on the leader tab.
   * Each task has its own try/catch so that one failure does not block the rest.
   */
  private async tick(): Promise<void> {
    if (this.state !== 'leader') return;

    // 1. Release notifications that were delayed by DND
    try { await this.dndService.releaseExpiredDelays(); }
    catch (e) { console.error('[Scheduler] dndService.releaseExpiredDelays failed:', e); }

    // 2. Expire offers whose deadline has passed (through the service layer —
    //    enforces state machine, optimistic lock, and audit log)
    try { await this.processOfferExpirations(); }
    catch (e) { console.error('[Scheduler] processOfferExpirations failed:', e); }

    // 3. Generate daily digests for all users (runs only at/after DIGEST_HOUR)
    try { await this.runDigestGeneration(); }
    catch (e) { console.error('[Scheduler] runDigestGeneration failed:', e); }

    // 4. Retry queued webhook deliveries
    try { await this.integrationService.processWebhookRetries(); }
    catch (e) { console.error('[Scheduler] processWebhookRetries failed:', e); }

    // 5. Clean up expired idempotency keys
    try { await this.integrationService.cleanupExpiredKeys(); }
    catch (e) { console.error('[Scheduler] cleanupExpiredKeys failed:', e); }

    // 6. Clear expired pin decorations on content posts
    try { await this.contentService.expirePins(); }
    catch (e) { console.error('[Scheduler] contentService.expirePins failed:', e); }

    // 7. Auto-publish scheduled posts whose publish time has arrived
    try { await this.contentService.publishScheduledPosts(); }
    catch (e) { console.error('[Scheduler] publishScheduledPosts failed:', e); }
  }

  /**
   * Find all Active applications in OfferExtended stage with a passed expiry
   * and expire each one through ApplicationService.expireOffer().
   *
   * This goes through the service layer so that the state machine assertion,
   * optimistic lock, and audit log are all enforced — even in the scheduler path.
   *
   * getAll() is acceptable here: the scheduler runs as a privileged system process
   * with no user org-scope, and the call is throttled to once per INTERVAL_MS.
   */
  private async processOfferExpirations(): Promise<void> {
    const all = await this.appRepo.getAll();
    const t = now();
    for (const app of all) {
      if (
        app.status === ApplicationStatus.Active &&
        app.stage === ApplicationStage.OfferExtended &&
        app.offerExpiresAt && app.offerExpiresAt <= t
      ) {
        try {
          await this.applicationService.expireOffer(app.id, app.organizationId, app.version);
        } catch (e) {
          // Log but continue — a concurrent update (OptimisticLockError) or an
          // application already expired by another path are acceptable here.
          console.error(`[Scheduler] expireOffer(${app.id}) failed:`, e);
        }
      }
    }
  }

  /**
   * Generate daily digests for all users once per day at DIGEST_HOUR.
   * DigestService.generateDigest() is idempotent (deduplicates by userId:date key),
   * so calling it multiple times in a day is safe; it returns null after the
   * first successful generation.
   */
  private async runDigestGeneration(): Promise<void> {
    const currentHour = new Date().getHours();
    if (currentHour < NOTIFICATION_CONSTANTS.DIGEST_HOUR) return;

    const users = await this.userRepo.getAll();
    for (const user of users) {
      try {
        await this.digestService.generateDigest(user.id, user.organizationId);
      } catch (e) {
        console.error(`[Scheduler] generateDigest(${user.id}) failed:`, e);
      }
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  private clearAllTimers(): void {
    if (this.tickIntervalId) { clearInterval(this.tickIntervalId); this.tickIntervalId = null; }
    if (this.heartbeatIntervalId) { clearInterval(this.heartbeatIntervalId); this.heartbeatIntervalId = null; }
    if (this.watchdogTimeoutId) { clearTimeout(this.watchdogTimeoutId); this.watchdogTimeoutId = null; }
    if (this.electionTimeoutId) { clearTimeout(this.electionTimeoutId); this.electionTimeoutId = null; }
    if (this.verifyClaimTimeoutId) { clearTimeout(this.verifyClaimTimeoutId); this.verifyClaimTimeoutId = null; }
  }
}
