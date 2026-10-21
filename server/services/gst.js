/**
 * GST Calculation Engine according to Indian GST regulations.
 * All monetary amounts are handled as integer paise (1 Rupee = 100 paise).
 */

export const SHOP_STATE_CODE = '32'; // Kerala

/**
 * Calculates line-level figures and document totals.
 *
 * @param {Object} params
 * @param {Array} params.lines
 * @param {boolean} params.pricesIncludeGst
 * @param {string} params.placeOfSupply - 2-digit state code (e.g. '32')
 * @param {boolean} params.isGstRegistered - Whether business has GSTIN registered
 * @param {number} params.extraCharges - Extra shipping/loading charges in paise
 * @returns {Object} Calculated summary and recalculated lines
 */
export function calculateDocumentTotals({
  lines = [],
  pricesIncludeGst = false,
  placeOfSupply = SHOP_STATE_CODE,
  isGstRegistered = true,
  extraCharges = 0
}) {
  const isInterstate = String(placeOfSupply).trim() !== SHOP_STATE_CODE;
  const safeExtraCharges = Math.max(0, Math.round(Number(extraCharges) || 0));

  let subtotalGross = 0;
  let totalDiscount = 0;
  let taxableAmountTotal = 0;

  // Track taxable amount grouped by GST rate percentage for consistent rate-wise rounding
  const rateBuckets = new Map();

  const processedLines = lines.map((line, index) => {
    const qty = Number(line.qty) || 0;
    const rate = Math.round(Number(line.rate) || 0); // paise
    const rawGstRate = isGstRegistered ? (Number(line.gstRate) || 0) : 0;
    const gstRate = Math.max(0, rawGstRate);

    let gross = Math.round(qty * rate); // paise
    let discountAmount = 0;

    if (line.discountType === 'percent') {
      const pct = Math.min(100, Math.max(0, Number(line.discountValue) || 0));
      discountAmount = Math.round((gross * pct) / 100);
    } else {
      discountAmount = Math.min(gross, Math.max(0, Math.round(Number(line.discountValue) || 0)));
    }

    let lineTaxable = gross - discountAmount;

    if (pricesIncludeGst && gstRate > 0) {
      // Taxable = round(line amount * 100 / (100 + gstRate))
      lineTaxable = Math.round((lineTaxable * 100) / (100 + gstRate));
    }

    subtotalGross += gross;
    totalDiscount += discountAmount;
    taxableAmountTotal += lineTaxable;

    // Accumulate in rate bucket
    const currentBucket = rateBuckets.get(gstRate) || 0;
    rateBuckets.set(gstRate, currentBucket + lineTaxable);

    return {
      slNo: index + 1,
      productId: line.productId || null,
      description: line.description || '',
      hsn: line.hsn ? String(line.hsn).trim() : null,
      qty,
      unit: line.unit || 'Nos',
      rate,
      purchasePrice: Math.round(Number(line.purchasePrice) || 0),
      discountType: line.discountType || 'amount',
      discountValue: Number(line.discountValue) || 0,
      discountAmount,
      taxableAmount: lineTaxable,
      gstRate,
      cgstAmount: 0, // Computed from rate bucket or allocated
      sgstAmount: 0,
      igstAmount: 0,
      lineTotal: lineTaxable
    };
  });

  // Calculate taxes per rate bucket
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  const taxSummary = [];

  for (const [rate, taxableSum] of rateBuckets.entries()) {
    if (rate <= 0 || !isGstRegistered) {
      taxSummary.push({
        gstRate: rate,
        taxableAmount: taxableSum,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: 0
      });
      continue;
    }

    if (isInterstate) {
      // IGST = round(taxable * rate / 100)
      const igst = Math.round((taxableSum * rate) / 100);
      igstTotal += igst;
      taxSummary.push({
        gstRate: rate,
        taxableAmount: taxableSum,
        cgst: 0,
        sgst: 0,
        igst,
        totalTax: igst
      });
    } else {
      // Intra-state: CGST = SGST = round(taxable * rate / 200), strictly EQUAL
      const halfTax = Math.round((taxableSum * rate) / 200);
      cgstTotal += halfTax;
      sgstTotal += halfTax;
      taxSummary.push({
        gstRate: rate,
        taxableAmount: taxableSum,
        cgst: halfTax,
        sgst: halfTax,
        igst: 0,
        totalTax: halfTax * 2
      });
    }
  }

  // Allocate line-level tax amounts proportionally for database line records
  for (const line of processedLines) {
    if (line.gstRate > 0 && isGstRegistered) {
      if (isInterstate) {
        line.igstAmount = Math.round((line.taxableAmount * line.gstRate) / 100);
        line.lineTotal = line.taxableAmount + line.igstAmount;
      } else {
        const half = Math.round((line.taxableAmount * line.gstRate) / 200);
        line.cgstAmount = half;
        line.sgstAmount = half;
        line.lineTotal = line.taxableAmount + (half * 2);
      }
    } else {
      line.lineTotal = line.taxableAmount;
    }
  }

  const totalTaxes = cgstTotal + sgstTotal + igstTotal;
  const preRoundTotal = taxableAmountTotal + totalTaxes + safeExtraCharges;

  // Round off to nearest rupee: 1 rupee = 100 paise
  const grandTotal = Math.round(preRoundTotal / 100) * 100;
  const roundOff = grandTotal - preRoundTotal; // positive or negative paise

  return {
    subtotalGross,
    totalDiscount,
    taxableAmount: taxableAmountTotal,
    cgstAmount: cgstTotal,
    sgstAmount: sgstTotal,
    igstAmount: igstTotal,
    totalTaxes,
    extraCharges: safeExtraCharges,
    roundOff,
    grandTotal,
    isInterstate,
    taxSummary,
    lines: processedLines
  };
}

export default {
  SHOP_STATE_CODE,
  calculateDocumentTotals
};
