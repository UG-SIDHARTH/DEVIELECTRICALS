import { describe, it, expect } from 'vitest';
import { getCurrentFinancialYear, validatePrefix } from '../services/numbering.js';

describe('Document Numbering Service', () => {
  it('computes Indian financial year correctly across April boundary', () => {
    // October 2026 -> 26-27
    const octDate = new Date('2026-10-21T10:00:00+05:30');
    expect(getCurrentFinancialYear(octDate)).toBe('26-27');

    // February 2027 -> Still 26-27
    const febDate = new Date('2027-02-15T10:00:00+05:30');
    expect(getCurrentFinancialYear(febDate)).toBe('26-27');

    // April 2027 -> 27-28
    const aprDate = new Date('2027-04-01T10:00:00+05:30');
    expect(getCurrentFinancialYear(aprDate)).toBe('27-28');
  });

  it('validates prefix format and character limits', () => {
    expect(validatePrefix('DE').valid).toBe(true);
    expect(validatePrefix('QT/A').valid).toBe(true);
    expect(validatePrefix('PO-1').valid).toBe(true);

    // Invalid symbols
    expect(validatePrefix('INV$').valid).toBe(false);
    expect(validatePrefix('DE@1').valid).toBe(false);

    // Too long prefix (would exceed 16 char max)
    expect(validatePrefix('VERYLONGPREFIX').valid).toBe(false);
  });
});
