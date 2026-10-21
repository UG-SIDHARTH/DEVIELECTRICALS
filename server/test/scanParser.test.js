import { describe, it, expect } from 'vitest';
import { parseMaterialList } from '../services/scanParser.js';

describe('Scan Material List Parser', () => {
  it('parses "2 coil 1.5 sqmm wire"', () => {
    const text = '2 coil 1.5 sqmm wire';
    const items = parseMaterialList(text);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(2);
    expect(items[0].unit).toBe('Coil');
    expect(items[0].specs).toContain('1.5SQMM');
    expect(items[0].checkQty).toBe(false);
  });

  it('parses "wire 1.5 sqmm - 2 coil"', () => {
    const text = 'wire 1.5 sqmm - 2 coil';
    const items = parseMaterialList(text);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(2);
    expect(items[0].unit).toBe('Coil');
    expect(items[0].specs).toContain('1.5SQMM');
  });

  it('parses "10 x 6A switch"', () => {
    const text = '10 x 6A switch';
    const items = parseMaterialList(text);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(10);
    expect(items[0].specs).toContain('6A');
  });

  it('parses "6A switch 10 nos"', () => {
    const text = '6A switch 10 nos';
    const items = parseMaterialList(text);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(10);
    expect(items[0].unit).toBe('Nos');
    expect(items[0].specs).toContain('6A');
  });

  it('parses "MCB 32A (5)"', () => {
    const text = 'MCB 32A (5)';
    const items = parseMaterialList(text);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(5);
    expect(items[0].specs).toContain('32A');
  });

  it('parses "switch 6a 10"', () => {
    const text = 'switch 6a 10';
    const items = parseMaterialList(text);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(10);
    expect(items[0].specs).toContain('6A');
  });

  it('filters out noise and header lines', () => {
    const text = `
Estimate Material List
Date: 21/10/2026
Phone: 9447220411
1. 2 coil 1.5 sqmm wire
Total: Rs 5000
    `.trim();

    const items = parseMaterialList(text);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(2);
  });
});
