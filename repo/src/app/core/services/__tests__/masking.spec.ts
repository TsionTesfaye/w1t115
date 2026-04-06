import { describe, it, expect } from 'vitest';
import { maskExceptLast, maskEmail } from '../../utils/masking';

describe('maskExceptLast', () => {
  it('masks all but last N characters', () => { expect(maskExceptLast('123456789', 4)).toBe('*****6789'); });
  it('returns original if shorter than visible count', () => { expect(maskExceptLast('abc', 5)).toBe('abc'); });
  it('handles SSN-like formats', () => { expect(maskExceptLast('123-45-6789', 4)).toBe('***-**-6789'); });
});

describe('maskEmail', () => {
  it('masks email local part', () => { expect(maskEmail('user@example.com')).toBe('u***@example.com'); });
  it('returns original for invalid email', () => { expect(maskEmail('noemail')).toBe('noemail'); });
  it('handles single char local', () => { expect(maskEmail('a@b.com')).toBe('a@b.com'); });
});
