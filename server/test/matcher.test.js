import { describe, it, expect } from 'vitest';
import { scoreProductMatch, matchScannedItems } from '../services/matcher.js';

describe('Product Matcher Service', () => {
  const mcb16A = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Single Pole MCB 16A',
    sku: 'MCB-SP-16A',
    brand: 'Legrand',
    category: 'Circuit Protection & Switchgear',
    spec: '16A',
    selling_price: 18000,
    gst_rate: 18,
    current_stock: 25,
    unit: 'Nos'
  };

  const mcb32A = {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Single Pole MCB 32A',
    sku: 'MCB-SP-32A',
    brand: 'Legrand',
    category: 'Circuit Protection & Switchgear',
    spec: '32A',
    selling_price: 22000,
    gst_rate: 18,
    current_stock: 15,
    unit: 'Nos'
  };

  it('strictly rejects spec mismatch: "32A MCB" NEVER matches a 16A MCB product', () => {
    const scoreMismatch = scoreProductMatch('32A MCB', mcb16A);
    expect(scoreMismatch).toBe(0);

    const scoreMatch = scoreProductMatch('32A MCB', mcb32A);
    expect(scoreMatch).toBeGreaterThan(0.7);
  });

  it('matches correct product when spec aligns', () => {
    const parsed = [{
      originalText: 'MCB 32A (5)',
      description: 'MCB 32A',
      qty: 5,
      unit: 'Nos',
      checkQty: false,
      specs: ['32A']
    }];

    const results = matchScannedItems(parsed, [mcb16A, mcb32A]);
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe('matched');
    expect(results[0].matchedProduct.id).toBe(mcb32A.id);
  });

  it('matches learned product aliases', () => {
    const wireProduct = {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Havells 1.5 sqmm FR Wire Red',
      sku: 'HAV-1.5-RED',
      spec: '1.5 sqmm',
      selling_price: 185000,
      gst_rate: 18,
      current_stock: 10,
      unit: 'Coil'
    };

    const aliases = [
      { product_id: wireProduct.id, alias: '1.5 red copper wire' }
    ];

    const score = scoreProductMatch('1.5 red copper wire', wireProduct, ['1.5 red copper wire']);
    expect(score).toBe(1.0);
  });
});
