import { describe, it, expect } from 'vitest';
import { amountInWords } from '../services/words.js';

describe('Amount in Words Service', () => {
  it('converts basic rupee amounts correctly', () => {
    // 1250000 paise = ₹12,500.00
    expect(amountInWords(1250000)).toBe('Rupees Twelve Thousand Five Hundred Only');
  });

  it('converts amounts with paise', () => {
    // 1250050 paise = ₹12,500.50
    expect(amountInWords(1250050)).toBe('Rupees Twelve Thousand Five Hundred and Fifty Paise Only');
  });

  it('handles zero amount', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });

  it('converts Lakh and Crore accurately', () => {
    // ₹1,25,00,000.00 = 1250000000 paise
    expect(amountInWords(1250000000)).toBe('Rupees One Crore Twenty Five Lakh Only');
  });
});
