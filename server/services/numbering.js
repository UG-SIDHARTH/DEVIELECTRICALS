/**
 * Financial year calculation and atomic sequential document numbering service.
 * Enforces Indian April-March financial year in Asia/Kolkata timezone.
 */

export function getCurrentFinancialYear(date = new Date()) {
  // Convert date to IST (UTC + 5:30)
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const istDate = new Date(utc + (3600000 * 5.5));

  const year = istDate.getFullYear();
  const month = istDate.getMonth(); // 0 = Jan, 3 = Apr

  if (month < 3) {
    // January to March falls into previous calendar year's FY
    const startYear = (year - 1).toString().slice(-2);
    const endYear = year.toString().slice(-2);
    return `${startYear}-${endYear}`;
  } else {
    // April to December
    const startYear = year.toString().slice(-2);
    const endYear = (year + 1).toString().slice(-2);
    return `${startYear}-${endYear}`;
  }
}

export function validatePrefix(prefix) {
  if (!prefix || typeof prefix !== 'string') {
    return { valid: false, message: 'Prefix must be a non-empty string' };
  }
  const clean = prefix.trim();
  if (!/^[A-Za-z0-9/-]+$/.test(clean)) {
    return { valid: false, message: 'Prefix may only contain alphanumeric characters, "/" and "-"' };
  }
  if (clean.length > 6) {
    return { valid: false, message: 'Prefix must be 6 characters or fewer to respect 16-character limit' };
  }
  return { valid: true, prefix: clean };
}

/**
 * Atomically allocates the next consecutive document number inside a transaction.
 *
 * @param {import('pg').PoolClient} client - Database transaction client
 * @param {string} docType - 'invoice', 'quotation', 'challan', 'purchase'
 * @param {string} prefix - Custom or settings prefix (e.g. 'DE', 'QT')
 * @returns {Promise<{ docNumber: string, fy: string, sequenceNumber: number }>}
 */
export async function allocateDocumentNumber(client, docType, prefix) {
  const fy = getCurrentFinancialYear();
  const valid = validatePrefix(prefix);
  if (!valid.valid) {
    throw new Error(valid.message);
  }

  // Acquire row-level lock on the sequence counter for this type & FY
  const checkRes = await client.query(
    'SELECT last_number FROM number_series WHERE type = $1 AND fy = $2 FOR UPDATE',
    [docType, fy]
  );

  let nextNumber = 1;
  if (checkRes.rows.length === 0) {
    await client.query(
      'INSERT INTO number_series (type, fy, last_number) VALUES ($1, $2, $3)',
      [docType, fy, 1]
    );
  } else {
    nextNumber = checkRes.rows[0].last_number + 1;
    await client.query(
      'UPDATE number_series SET last_number = $1 WHERE type = $2 AND fy = $3',
      [nextNumber, docType, fy]
    );
  }

  // Format: PREFIX/FY/0001
  const padded = String(nextNumber).padStart(4, '0');
  const docNumber = `${valid.prefix}/${fy}/${padded}`;

  if (docNumber.length > 16) {
    throw new Error(`Generated document number "${docNumber}" exceeds maximum 16 characters`);
  }

  return { docNumber, fy, sequenceNumber: nextNumber };
}

export default {
  getCurrentFinancialYear,
  validatePrefix,
  allocateDocumentNumber
};
