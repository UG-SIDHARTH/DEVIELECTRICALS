import { describe, it, expect } from 'vitest';
import { calculateDocumentTotals } from '../services/gst.js';

describe('GST Calculation Engine', () => {
  it('calculates intra-state invoice with equal CGST and SGST', () => {
    const lines = [
      { qty: 2, rate: 10000, gstRate: 18 } // 2 * ₹100.00 = ₹200.00 taxable
    ];

    const result = calculateDocumentTotals({
      lines,
      pricesIncludeGst: false,
      placeOfSupply: '32',
      isGstRegistered: true
    });

    expect(result.taxableAmount).toBe(20000); // 20000 paise = ₹200.00
    // CGST and SGST at 9% each on ₹200.00 = ₹18.00 each = 1800 paise
    expect(result.cgstAmount).toBe(1800);
    expect(result.sgstAmount).toBe(1800);
    expect(result.cgstAmount).toBe(result.sgstAmount);
    expect(result.igstAmount).toBe(0);
    expect(result.grandTotal).toBe(23600); // ₹236.00
  });

  it('calculates three-rate intra-state invoice with equal CGST and SGST per rate', () => {
    const lines = [
      { qty: 10, rate: 1000, gstRate: 5 },  // 10 * ₹10 = ₹100 @ 5% -> Tax = ₹5
      { qty: 5, rate: 2000, gstRate: 12 },  // 5 * ₹20 = ₹100 @ 12% -> Tax = ₹12
      { qty: 1, rate: 10000, gstRate: 18 }  // 1 * ₹100 = ₹100 @ 18% -> Tax = ₹18
    ];

    const result = calculateDocumentTotals({
      lines,
      placeOfSupply: '32',
      isGstRegistered: true
    });

    expect(result.taxableAmount).toBe(30000); // ₹300.00
    // Total Tax: 500 + 1200 + 1800 = 3500 paise (CGST: 1750, SGST: 1750)
    expect(result.cgstAmount).toBe(1750);
    expect(result.sgstAmount).toBe(1750);
    expect(result.cgstAmount).toBe(result.sgstAmount);
    expect(result.grandTotal).toBe(33500); // ₹335.00
  });

  it('calculates tax-inclusive line amounts accurately', () => {
    // 1 item sold at ₹118.00 inclusive of 18% GST -> Taxable must be ₹100.00
    const lines = [
      { qty: 1, rate: 11800, gstRate: 18 }
    ];

    const result = calculateDocumentTotals({
      lines,
      pricesIncludeGst: true,
      placeOfSupply: '32',
      isGstRegistered: true
    });

    expect(result.taxableAmount).toBe(10000); // ₹100.00
    expect(result.cgstAmount).toBe(900);
    expect(result.sgstAmount).toBe(900);
    expect(result.grandTotal).toBe(11800);
  });

  it('calculates round-off to nearest rupee correctly', () => {
    // Taxable ₹100.55 -> preRound 10055 paise -> grand total must round to 10100 (₹101.00), roundOff +45 paise
    const lines = [
      { qty: 1, rate: 10055, gstRate: 0 }
    ];

    const result = calculateDocumentTotals({
      lines,
      placeOfSupply: '32',
      isGstRegistered: false
    });

    expect(result.taxableAmount).toBe(10055);
    expect(result.grandTotal).toBe(10100);
    expect(result.roundOff).toBe(45);
  });

  it('calculates inter-state invoice using IGST only', () => {
    const lines = [
      { qty: 1, rate: 10000, gstRate: 18 }
    ];

    const result = calculateDocumentTotals({
      lines,
      placeOfSupply: '33', // Tamil Nadu
      isGstRegistered: true
    });

    expect(result.isInterstate).toBe(true);
    expect(result.cgstAmount).toBe(0);
    expect(result.sgstAmount).toBe(0);
    expect(result.igstAmount).toBe(1800);
    expect(result.grandTotal).toBe(11800);
  });
});
