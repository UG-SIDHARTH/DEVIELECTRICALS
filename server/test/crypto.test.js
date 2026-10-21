import { describe, it, expect } from 'vitest';
import { encryptField, decryptField, computeBlindIndex } from '../security/crypto.js';

describe('Cryptographic Security Engine', () => {
  it('encrypts and decrypts field using row-bound AAD', () => {
    const plaintext = '094472 20411';
    const aad = 'customers.phone.uuid-1234';

    const encrypted = encryptField(plaintext, aad);
    expect(encrypted).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

    const decrypted = decryptField(encrypted, aad);
    expect(decrypted).toBe(plaintext);
  });

  it('fails decryption if row AAD is tampered with or moved across rows', () => {
    const plaintext = '32AAAAA0000A1Z5';
    const originalAad = 'customers.gstin.row-A';
    const attackerAad = 'customers.gstin.row-B'; // Attempting to transplant ciphertext to row B

    const encrypted = encryptField(plaintext, originalAad);

    // Decryption with incorrect row AAD must throw authentication error
    expect(() => {
      decryptField(encrypted, attackerAad);
    }).toThrow();
  });

  it('fails decryption if ciphertext payload is modified', () => {
    const plaintext = 'Secret Bank Account 123456789';
    const aad = 'settings.bank_account.1';

    const encrypted = encryptField(plaintext, aad);
    const parts = encrypted.split(':');

    // Corrupt ciphertext byte
    const corruptedCiphertext = 'A' + parts[2].slice(1);
    const tampered = `${parts[0]}:${parts[1]}:${corruptedCiphertext}:${parts[3]}`;

    expect(() => {
      decryptField(tampered, aad);
    }).toThrow();
  });

  it('computes deterministic blind indexes for normalized phone and GSTIN', () => {
    // Phone numbers with varied formatting must yield identical blind index
    const bidx1 = computeBlindIndex('+91 94472 20411', 'phone');
    const bidx2 = computeBlindIndex('09447220411', 'phone');
    const bidx3 = computeBlindIndex('9447220411', 'phone');

    expect(bidx1).toBe(bidx2);
    expect(bidx2).toBe(bidx3);

    // GSTIN normalization
    const gstin1 = computeBlindIndex('32aaaaa0000a1z5', 'gstin');
    const gstin2 = computeBlindIndex('32AAAAA0000A1Z5', 'gstin');
    expect(gstin1).toBe(gstin2);
  });
});
