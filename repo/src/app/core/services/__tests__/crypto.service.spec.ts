/**
 * CryptoService tests — real Web Crypto API (available in Node 18 + Vitest jsdom env).
 *
 * All PBKDF2 calls use iterations=1 to keep tests fast while still exercising
 * the real derivation code path.
 */

import { describe, it, expect } from 'vitest';
import { CryptoService } from '../crypto.service';

const svc = new CryptoService();

/** A valid 32-char hex salt (16 bytes). */
const SALT = 'aabbccdd11223344aabbccdd11223344';

// ── hashPassword ─────────────────────────────────────────────────────────────

describe('CryptoService.hashPassword', () => {
  it('returns a 64-char hex string', async () => {
    const hash = await svc.hashPassword('password', SALT, 1);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic — same inputs produce same hash', async () => {
    const h1 = await svc.hashPassword('password', SALT, 1);
    const h2 = await svc.hashPassword('password', SALT, 1);
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different passwords', async () => {
    const h1 = await svc.hashPassword('password1', SALT, 1);
    const h2 = await svc.hashPassword('password2', SALT, 1);
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes for different salts', async () => {
    const salt2 = 'bbccddee22334455bbccddee22334455';
    const h1 = await svc.hashPassword('password', SALT, 1);
    const h2 = await svc.hashPassword('password', salt2, 1);
    expect(h1).not.toBe(h2);
  });
});

// ── verifyPassword ────────────────────────────────────────────────────────────

describe('CryptoService.verifyPassword', () => {
  it('returns true for the correct password', async () => {
    const hash = await svc.hashPassword('mypassword', SALT, 1);
    expect(await svc.verifyPassword('mypassword', hash, SALT, 1)).toBe(true);
  });

  it('returns false for a wrong password', async () => {
    const hash = await svc.hashPassword('mypassword', SALT, 1);
    expect(await svc.verifyPassword('wrongpassword', hash, SALT, 1)).toBe(false);
  });
});

// ── encrypt / decrypt ─────────────────────────────────────────────────────────

describe('CryptoService.encrypt / decrypt', () => {
  it('round-trips plaintext correctly', async () => {
    const key = await svc.deriveEncryptionKey('secret', SALT);
    const { iv, ciphertext } = await svc.encrypt('Hello, World!', key);
    const plaintext = await svc.decrypt(ciphertext, iv, key);
    expect(plaintext).toBe('Hello, World!');
  });

  it('round-trips with AAD when AAD matches', async () => {
    const key = await svc.deriveEncryptionKey('secret', SALT);
    const aad = 'user:u1|org:org1';
    const { iv, ciphertext } = await svc.encrypt('sensitive data', key, aad);
    const plaintext = await svc.decrypt(ciphertext, iv, key, aad);
    expect(plaintext).toBe('sensitive data');
  });

  it('throws when AAD does not match', async () => {
    const key = await svc.deriveEncryptionKey('secret', SALT);
    const { iv, ciphertext } = await svc.encrypt('sensitive data', key, 'correct-aad');
    await expect(svc.decrypt(ciphertext, iv, key, 'wrong-aad')).rejects.toThrow();
  });

  it('throws when decrypting with wrong key', async () => {
    const key1 = await svc.deriveEncryptionKey('secret1', SALT);
    const key2 = await svc.deriveEncryptionKey('secret2', SALT);
    const { iv, ciphertext } = await svc.encrypt('data', key1);
    await expect(svc.decrypt(ciphertext, iv, key2)).rejects.toThrow();
  });
});

// ── computeHmac / verifyHmac ──────────────────────────────────────────────────

describe('CryptoService.computeHmac / verifyHmac', () => {
  const SECRET = 'webhook-secret-key';
  const MESSAGE = '{"event":"test","id":42}';

  it('verifyHmac returns true for a valid signature', async () => {
    const sig = await svc.computeHmac(MESSAGE, SECRET);
    expect(await svc.verifyHmac(MESSAGE, sig, SECRET)).toBe(true);
  });

  it('verifyHmac returns false for a tampered message', async () => {
    const sig = await svc.computeHmac(MESSAGE, SECRET);
    expect(await svc.verifyHmac(MESSAGE + 'x', sig, SECRET)).toBe(false);
  });

  it('verifyHmac returns false for a tampered signature', async () => {
    const sig = await svc.computeHmac(MESSAGE, SECRET);
    const tampered = sig.slice(0, -2) + 'ff';
    expect(await svc.verifyHmac(MESSAGE, tampered, SECRET)).toBe(false);
  });

  it('verifyHmac returns false for a malformed (odd-length) hex signature', async () => {
    expect(await svc.verifyHmac(MESSAGE, 'abc', SECRET)).toBe(false);
  });

  it('verifyHmac returns false when using the wrong secret', async () => {
    const sig = await svc.computeHmac(MESSAGE, SECRET);
    expect(await svc.verifyHmac(MESSAGE, sig, 'different-secret')).toBe(false);
  });
});

// ── sha256 ────────────────────────────────────────────────────────────────────

describe('CryptoService.sha256', () => {
  it('returns a 64-char hex string', async () => {
    const hash = await svc.sha256('test input');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', async () => {
    const h1 = await svc.sha256('hello');
    const h2 = await svc.sha256('hello');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different inputs', async () => {
    expect(await svc.sha256('a')).not.toBe(await svc.sha256('b'));
  });
});

// ── bufferToHex / hexToBuffer ──────────────────────────────────────────────────

describe('CryptoService.bufferToHex / hexToBuffer', () => {
  it('round-trips a Uint8Array through hex', () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = svc.bufferToHex(original);
    expect(hex).toBe('deadbeef');
    const roundtripped = svc.hexToBuffer(hex);
    expect(Array.from(roundtripped)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('bufferToHex pads single-digit bytes with a leading zero', () => {
    const buf = new Uint8Array([0x00, 0x0f, 0xff]);
    expect(svc.bufferToHex(buf)).toBe('000fff');
  });

  it('hexToBuffer throws RangeError for odd-length input', () => {
    expect(() => svc.hexToBuffer('abc')).toThrow(RangeError);
  });

  it('hexToBuffer handles empty string', () => {
    expect(Array.from(svc.hexToBuffer(''))).toEqual([]);
  });
});

// ── generateSalt ──────────────────────────────────────────────────────────────

describe('CryptoService.generateSalt', () => {
  it('returns a 32-char hex string by default (16 bytes)', () => {
    const salt = svc.generateSalt();
    expect(salt).toHaveLength(32);
    expect(salt).toMatch(/^[0-9a-f]+$/);
  });

  it('generates unique salts on every call', () => {
    const s1 = svc.generateSalt();
    const s2 = svc.generateSalt();
    expect(s1).not.toBe(s2);
  });
});
