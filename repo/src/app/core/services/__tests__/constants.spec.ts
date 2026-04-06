import { describe, it, expect } from 'vitest';
import { AUTH_CONSTANTS, DOCUMENT_CONSTANTS, NOTIFICATION_CONSTANTS, MODERATION_CONSTANTS, INTEGRATION_CONSTANTS } from '../../constants';

describe('AUTH_CONSTANTS', () => {
  it('has correct lockout rules', () => {
    expect(AUTH_CONSTANTS.CAPTCHA_THRESHOLD).toBe(3);
    expect(AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS).toBe(5);
    expect(AUTH_CONSTANTS.LOCKOUT_DURATION_MINUTES).toBe(15);
    expect(AUTH_CONSTANTS.CAPTCHA_THRESHOLD).toBeLessThan(AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS);
  });
  it('has session timeouts', () => {
    expect(AUTH_CONSTANTS.SESSION_TIMEOUT_MINUTES).toBe(30);
    expect(AUTH_CONSTANTS.REMEMBER_SESSION_DAYS).toBe(7);
  });
  it('has strong PBKDF2 iterations', () => { expect(AUTH_CONSTANTS.PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100000); });
});

describe('DOCUMENT_CONSTANTS', () => {
  it('has 25MB per file limit', () => { expect(DOCUMENT_CONSTANTS.MAX_FILE_SIZE_BYTES).toBe(25 * 1024 * 1024); });
  it('has 200MB per account limit', () => { expect(DOCUMENT_CONSTANTS.MAX_ACCOUNT_STORAGE_BYTES).toBe(200 * 1024 * 1024); });
  it('every MIME has matching extensions', () => {
    for (const mime of DOCUMENT_CONSTANTS.ALLOWED_MIME_TYPES) {
      expect(DOCUMENT_CONSTANTS.MIME_EXTENSION_MAP.has(mime)).toBe(true);
    }
  });
});

describe('NOTIFICATION_CONSTANTS', () => {
  it('limits 3 instant per type per day', () => { expect(NOTIFICATION_CONSTANTS.MAX_INSTANT_PER_TYPE_PER_DAY).toBe(3); });
});

describe('MODERATION_CONSTANTS', () => {
  it('limits 3 links per comment', () => { expect(MODERATION_CONSTANTS.MAX_LINKS_PER_COMMENT).toBe(3); });
  it('has 30s cooldown', () => { expect(MODERATION_CONSTANTS.COOLDOWN_SECONDS).toBe(30); });
});

describe('INTEGRATION_CONSTANTS', () => {
  it('rate limits at 60/min', () => { expect(INTEGRATION_CONSTANTS.RATE_LIMIT_PER_MINUTE).toBe(60); });
  it('idempotency keys expire in 24h', () => { expect(INTEGRATION_CONSTANTS.IDEMPOTENCY_KEY_TTL_HOURS).toBe(24); });
  it('max 5 webhook retries', () => { expect(INTEGRATION_CONSTANTS.MAX_WEBHOOK_RETRIES).toBe(5); });
});
