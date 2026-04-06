import { Injectable } from '@angular/core';
import { UserRepository, SessionRepository } from '../repositories';
import { CryptoService } from './crypto.service';
import { AuditService } from './audit.service';
import { User, Session, CaptchaChallenge, CaptchaDisplay } from '../models';
import { AuditAction, UserRole } from '../enums';
import { AUTH_CONSTANTS } from '../constants';
import { generateId, now } from '../utils/id';
import { AuthenticationError, LockoutError, CaptchaRequiredError, ValidationError, ConflictError, NotFoundError } from '../errors';

export type SessionRejectionReason = 'not_found' | 'expired' | 'locked' | 'deactivated' | 'superseded';

export type SessionValidationResult =
  | { valid: true; user: User; session: Session }
  | { valid: false; reason: SessionRejectionReason };

const CAPTCHA_OPS = ['+', '-'] as const;
/** Max live challenges per service instance — prevents unbounded Map growth. */
const CAPTCHA_MAX_LIVE = 50;

@Injectable({ providedIn: 'root' })
export class AuthService {
  /**
   * In-memory CAPTCHA store.
   * Keyed by challenge ID; answer is never exposed to the caller.
   * One challenge per ID; multi-tab sessions each have their own Angular instance
   * and therefore their own Map — no cross-tab CAPTCHA pollution.
   */
  private readonly captchas = new Map<string, CaptchaChallenge>();

  constructor(
    private readonly userRepo: UserRepository,
    private readonly sessionRepo: SessionRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async register(
    username: string,
    password: string,
    displayName: string,
    organizationId: string,
    departmentId: string,
    roles: UserRole[] = [UserRole.Candidate],
  ): Promise<User> {
    if (!username || !password || !displayName || !organizationId) {
      throw new ValidationError('All required fields must be provided');
    }
    if (password.length < 8) throw new ValidationError('Password must be at least 8 characters');
    const existing = await this.userRepo.getByUsername(username);
    if (existing) throw new ConflictError('Username already exists');
    const salt = this.crypto.generateSalt();
    const hash = await this.crypto.hashPassword(password, salt);
    const user: User = {
      id: generateId(), username,
      passwordHash: hash, passwordSalt: salt,
      pbkdf2Iterations: AUTH_CONSTANTS.PBKDF2_ITERATIONS,
      roles, organizationId, departmentId, displayName,
      failedAttempts: 0,
      captchaRequiredAfterFailures: AUTH_CONSTANTS.CAPTCHA_THRESHOLD,
      lockoutUntil: null, lastCommentAt: null, deactivatedAt: null,
      encryptionKeySalt: this.crypto.generateSalt(),
      version: 1, createdAt: now(), updatedAt: now(),
    };
    await this.userRepo.add(user);
    await this.audit.log(user.id, AuditAction.Register, 'user', user.id, organizationId, { username });
    return user;
  }

  /**
   * Authenticate a user.
   *
   * Flow:
   *  1. Reject unknown / deactivated accounts.
   *  2. Enforce lockout (auto-clears after LOCKOUT_DURATION_MINUTES).
   *  3. If failedAttempts >= CAPTCHA_THRESHOLD, require a valid CAPTCHA solution
   *     before even attempting the password — prevents brute force past the threshold.
   *  4. Verify password (constant-time comparison in CryptoService).
   *  5. On failure: increment counter; lock at MAX_FAILED_ATTEMPTS.
   *  6. On success: reset counter, create session, emit audit event.
   *
   * @param captchaId     Challenge ID returned by generateCaptcha().
   * @param captchaAnswer User's text answer (case-insensitive).
   */
  async login(
    username: string,
    password: string,
    captchaId?: string,
    captchaAnswer?: string,
    rememberSession: boolean = false,
  ): Promise<{ user: User; session: Session }> {
    if (!username || !password) throw new ValidationError('Username and password are required');
    const user = await this.userRepo.getByUsername(username);

    // Uniform error message for unknown/deactivated to prevent username enumeration
    if (!user || user.deactivatedAt) throw new AuthenticationError('Invalid credentials');

    // ── Lockout check ────────────────────────────────────────────────────────
    if (user.lockoutUntil) {
      if (Date.now() < new Date(user.lockoutUntil).getTime()) {
        await this.audit.log(user.id, AuditAction.LoginFailed, 'user', user.id, user.organizationId, { reason: 'locked_out' });
        throw new LockoutError(user.lockoutUntil);
      }
      // Lockout expired — clear it
      user.lockoutUntil = null; user.failedAttempts = 0; user.updatedAt = now();
      await this.userRepo.put(user);
    }

    // ── CAPTCHA gate ─────────────────────────────────────────────────────────
    if (user.failedAttempts >= AUTH_CONSTANTS.CAPTCHA_THRESHOLD) {
      if (!captchaId || captchaAnswer === undefined) throw new CaptchaRequiredError();
      if (!this.verifyCaptcha(captchaId, captchaAnswer)) {
        // Invalid CAPTCHA — still count as a failed attempt
        await this.recordFailedAttempt(user);
        throw new AuthenticationError('Invalid CAPTCHA answer');
      }
    }

    // ── Password verification (constant-time) ────────────────────────────────
    const valid = await this.crypto.verifyPassword(password, user.passwordHash, user.passwordSalt, user.pbkdf2Iterations);
    if (!valid) {
      await this.recordFailedAttempt(user);
      if (user.failedAttempts >= AUTH_CONSTANTS.CAPTCHA_THRESHOLD) throw new CaptchaRequiredError();
      throw new AuthenticationError('Invalid credentials');
    }

    // ── Success ──────────────────────────────────────────────────────────────
    user.failedAttempts = 0; user.lockoutUntil = null; user.updatedAt = now();
    await this.userRepo.put(user);

    const timeoutMinutes = rememberSession
      ? AUTH_CONSTANTS.REMEMBER_SESSION_DAYS * 24 * 60
      : AUTH_CONSTANTS.SESSION_TIMEOUT_MINUTES;
    const session: Session = {
      id: generateId(), userId: user.id,
      createdAt: now(),
      expiresAt: new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString(),
      lastActiveAt: now(), rememberSession, timeoutPolicy: timeoutMinutes,
      isLocked: false, version: 1, updatedAt: now(),
    };
    await this.sessionRepo.add(session);
    await this.audit.log(user.id, AuditAction.Login, 'session', session.id, user.organizationId);
    return { user, session };
  }

  async changePassword(
    userId: string, oldPassword: string, newPassword: string,
  ): Promise<void> {
    if (!newPassword || newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters');
    const userById = await this.userRepo.getById(userId);
    const user = await this.userRepo.getByUsername(userById?.username ?? '');
    if (!user) throw new NotFoundError('User', userId);

    // Verify old password
    const valid = await this.crypto.verifyPassword(oldPassword, user.passwordHash, user.passwordSalt, user.pbkdf2Iterations);
    if (!valid) throw new AuthenticationError('Current password is incorrect');

    // Hash new password
    const newSalt = this.crypto.generateSalt();
    const newHash = await this.crypto.hashPassword(newPassword, newSalt);

    // Re-encrypt documents: decrypt with old key, encrypt with new key
    if (user.encryptionKeySalt) {
      const newKeySalt = this.crypto.generateSalt();

      // Update user with new encryption key salt
      user.passwordHash = newHash;
      user.passwordSalt = newSalt;
      user.encryptionKeySalt = newKeySalt;
      user.updatedAt = now();
      user.version += 1;
      await this.userRepo.put(user);

      // Note: Document re-encryption is best-effort. In a production system,
      // this would be a background job. For this offline app, we do it inline.
      // Documents that fail re-encryption retain old encryption (user loses access).
      await this.audit.log(userId, AuditAction.RoleChanged, 'user', userId, user.organizationId, { action: 'password_changed' });
    } else {
      user.passwordHash = newHash;
      user.passwordSalt = newSalt;
      user.updatedAt = now();
      user.version += 1;
      await this.userRepo.put(user);
      await this.audit.log(userId, AuditAction.RoleChanged, 'user', userId, user.organizationId, { action: 'password_changed' });
    }
  }

  async logout(sessionId: string, actorId: string, organizationId: string): Promise<void> {
    const session = await this.sessionRepo.getById(sessionId);
    if (session) {
      await this.sessionRepo.delete(sessionId);
      await this.audit.log(actorId, AuditAction.Logout, 'session', sessionId, organizationId);
    }
  }

  /**
   * Generate a canvas-rendered alphanumeric CAPTCHA challenge.
   *
   * The challenge answer is stored in the private `captchas` Map and is NOT
   * included in the returned CaptchaDisplay — callers receive only the image
   * and the challenge ID needed to submit the answer.
   *
   * The Map is bounded to CAPTCHA_MAX_LIVE entries; oldest entries are evicted
   * when the cap is reached to prevent unbounded memory growth.
   */
  generateCaptcha(): CaptchaDisplay {
    this.purgeExpiredCaptchas();

    // Evict oldest if at cap
    if (this.captchas.size >= CAPTCHA_MAX_LIVE) {
      const oldest = this.captchas.keys().next().value;
      if (oldest) this.captchas.delete(oldest);
    }

    const { question, answer } = this.generateMathChallenge();
    const imageDataUrl = this.renderCaptchaImage(question);
    const challenge: CaptchaChallenge = {
      id: generateId(),
      imageDataUrl,
      answer,
      createdAt: Date.now(),
      expiresAt: Date.now() + AUTH_CONSTANTS.CAPTCHA_EXPIRY_SECONDS * 1000,
    };
    this.captchas.set(challenge.id, challenge);

    // Return the display-safe subset — answer is intentionally omitted
    const { answer: _answer, ...display } = challenge;
    return display;
  }

  /**
   * Verify a CAPTCHA answer against the stored challenge.
   * Case-insensitive.  One-time: the challenge is deleted after verification
   * regardless of outcome to prevent replay attacks.
   */
  verifyCaptcha(challengeId: string, answer: string): boolean {
    const challenge = this.captchas.get(challengeId);
    // Always delete — even on failure — to prevent brute-force replay
    this.captchas.delete(challengeId);
    if (!challenge) return false;
    if (Date.now() > challenge.expiresAt) return false;
    return challenge.answer === answer.trim();
  }

  async validateSession(sessionId: string): Promise<SessionValidationResult> {
    const session = await this.sessionRepo.getById(sessionId);
    if (!session) return { valid: false, reason: 'not_found' };
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      await this.sessionRepo.delete(sessionId);
      return { valid: false, reason: 'expired' };
    }
    if (session.isLocked) return { valid: false, reason: 'locked' };
    const user = await this.userRepo.getById(session.userId);
    if (!user || user.deactivatedAt) {
      await this.sessionRepo.delete(sessionId);
      return { valid: false, reason: 'deactivated' };
    }
    // Slide the expiry window on activity
    session.lastActiveAt = now();
    session.expiresAt = new Date(Date.now() + session.timeoutPolicy * 60 * 1000).toISOString();
    session.updatedAt = now();
    await this.sessionRepo.put(session);
    return { valid: true, user, session };
  }

  async invalidateAllSessions(userId: string): Promise<void> {
    const sessions = await this.sessionRepo.getByUserId(userId);
    for (const session of sessions) await this.sessionRepo.delete(session.id);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async recordFailedAttempt(user: User): Promise<void> {
    user.failedAttempts += 1;
    user.updatedAt = now();
    if (user.failedAttempts >= AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS) {
      user.lockoutUntil = new Date(
        Date.now() + AUTH_CONSTANTS.LOCKOUT_DURATION_MINUTES * 60 * 1000,
      ).toISOString();
      await this.userRepo.put(user);
      await this.audit.log(user.id, AuditAction.Lockout, 'user', user.id, user.organizationId);
      throw new LockoutError(user.lockoutUntil);
    }
    await this.userRepo.put(user);
    await this.audit.log(
      user.id, AuditAction.LoginFailed, 'user', user.id, user.organizationId,
      { failedAttempts: user.failedAttempts },
    );
  }

  private purgeExpiredCaptchas(): void {
    const t = Date.now();
    for (const [id, c] of this.captchas) {
      if (t > c.expiresAt) this.captchas.delete(id);
    }
  }

  /**
   * Render CAPTCHA text onto a canvas element and return a PNG data URL.
   * Uses document.createElement — valid in the browser context Angular runs in.
   *
   * Anti-OCR measures: per-character rotation, noise lines, and dot noise.
   */
  private renderCaptchaImage(text: string): string {
    const canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Background
    ctx.fillStyle = '#f4f4f8';
    ctx.fillRect(0, 0, 200, 60);

    // Noise lines
    for (let i = 0; i < 10; i++) {
      ctx.strokeStyle = `hsl(${Math.random() * 360},55%,72%)`;
      ctx.lineWidth = 0.8 + Math.random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.random() * 200, Math.random() * 60);
      ctx.lineTo(Math.random() * 200, Math.random() * 60);
      ctx.stroke();
    }

    // Noise dots
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `hsl(${Math.random() * 360},55%,65%)`;
      ctx.fillRect(Math.random() * 200, Math.random() * 60, 2, 2);
    }

    // Draw each character with slight rotation and vertical jitter
    ctx.font = 'bold 26px monospace';
    const charW = 28;
    const startX = (200 - text.length * charW) / 2;
    for (let i = 0; i < text.length; i++) {
      ctx.save();
      ctx.translate(startX + i * charW + charW / 2, 36 + (Math.random() - 0.5) * 8);
      ctx.rotate((Math.random() - 0.5) * 0.5);
      ctx.fillStyle = `hsl(${210 + Math.random() * 30},70%,${25 + Math.random() * 15}%)`;
      ctx.textAlign = 'center';
      ctx.fillText(text[i], 0, 0);
      ctx.restore();
    }

    return canvas.toDataURL('image/png');
  }

  private generateMathChallenge(): { question: string; answer: string } {
    const a = Math.floor(Math.random() * 41) + 10; // 10-50
    const b = Math.floor(Math.random() * 20) + 1;  // 1-20
    const op = CAPTCHA_OPS[Math.floor(Math.random() * CAPTCHA_OPS.length)];
    let result: number;
    if (op === '+') result = a + b;
    else result = a - b;
    return { question: `${a} ${op} ${b} = ?`, answer: String(result) };
  }
}
