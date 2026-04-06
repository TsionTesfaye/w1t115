import { Injectable } from '@angular/core';
import { AUTH_CONSTANTS } from '../constants';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  generateSalt(length: number = AUTH_CONSTANTS.SALT_LENGTH): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return this.bufferToHex(bytes);
  }

  async hashPassword(password: string, salt: string, iterations?: number): Promise<string> {
    const iter = iterations ?? AUTH_CONSTANTS.PBKDF2_ITERATIONS;
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'],
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: this.hexToBuffer(salt), iterations: iter, hash: 'SHA-256' },
      keyMaterial,
      AUTH_CONSTANTS.HASH_LENGTH * 8,
    );
    return this.bufferToHex(new Uint8Array(derivedBits));
  }

  /**
   * Constant-time password verification.
   * Derives a fresh hash and compares byte-by-byte with XOR accumulation so
   * the comparison time does not vary with the position of the first differing byte.
   */
  async verifyPassword(password: string, storedHash: string, salt: string, iterations?: number): Promise<boolean> {
    const hash = await this.hashPassword(password, salt, iterations);
    return this.constantTimeEqual(this.hexToBuffer(hash), this.hexToBuffer(storedHash));
  }

  async deriveEncryptionKey(password: string, salt: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: this.hexToBuffer(salt), iterations: AUTH_CONSTANTS.PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * AES-256-GCM encrypt.
   * @param aad  Optional additional authenticated data (e.g. userId + orgId).
   *             The AAD is authenticated but not encrypted; the same AAD must be
   *             supplied to decrypt().  Binding context prevents ciphertexts from
   *             being transplanted to a different user or organisation.
   */
  async encrypt(data: string, key: CryptoKey, aad?: string): Promise<{ iv: string; ciphertext: string }> {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const params: AesGcmParams = { name: 'AES-GCM', iv };
    if (aad) params.additionalData = encoder.encode(aad);
    const encrypted = await crypto.subtle.encrypt(params, key, encoder.encode(data));
    return { iv: this.bufferToHex(iv), ciphertext: this.bufferToHex(new Uint8Array(encrypted)) };
  }

  /** Counterpart to encrypt(); aad must match what was passed to encrypt(). */
  async decrypt(ciphertext: string, iv: string, key: CryptoKey, aad?: string): Promise<string> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const params: AesGcmParams = { name: 'AES-GCM', iv: this.hexToBuffer(iv) };
    if (aad) params.additionalData = encoder.encode(aad);
    const decrypted = await crypto.subtle.decrypt(params, key, this.hexToBuffer(ciphertext));
    return decoder.decode(decrypted);
  }

  async computeHmac(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return this.bufferToHex(new Uint8Array(signature));
  }

  /**
   * Constant-time HMAC verification via crypto.subtle.verify().
   * crypto.subtle.verify() is guaranteed by spec to run in constant time,
   * preventing timing-based signature-oracle attacks.
   */
  async verifyHmac(message: string, signature: string, secret: string): Promise<boolean> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    let sigBytes: Uint8Array;
    try {
      sigBytes = this.hexToBuffer(signature);
    } catch {
      return false; // malformed hex — not a valid signature
    }
    return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(message));
  }

  async sha256(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(input));
    return this.bufferToHex(new Uint8Array(hash));
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  hexToBuffer(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) throw new RangeError(`Invalid hex string length: ${hex.length}`);
    const buf = new ArrayBuffer(hex.length / 2);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  /**
   * Constant-time byte comparison.
   * Returns true iff both buffers have the same length and identical bytes.
   * The XOR accumulator ensures every byte is always compared regardless of
   * where the first difference occurs, preventing timing leaks.
   */
  private constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
}
