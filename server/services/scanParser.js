/**
 * Material List OCR Text Parser.
 * Robustly parses handwritten and typed electrician material lists into structured items,
 * quantities, units, and electrical specifications.
 */

const KNOWN_UNITS = new Set([
  'mtr', 'meter', 'meters', 'mt', 'm',
  'pc', 'pcs', 'piece', 'pieces',
  'no', 'nos', 'number', 'numbers',
  'box', 'boxes', 'pkt', 'packet', 'packets',
  'rl', 'roll', 'rolls', 'coil', 'coils',
  'set', 'sets', 'kg'
]);

const UNIT_SYNONYMS = {
  mtr: 'Mtr', meter: 'Mtr', meters: 'Mtr', mt: 'Mtr', m: 'Mtr',
  pc: 'Nos', pcs: 'Nos', piece: 'Nos', pieces: 'Nos',
  no: 'Nos', nos: 'Nos', number: 'Nos', numbers: 'Nos',
  box: 'Box', boxes: 'Box', pkt: 'Pkt', packet: 'Pkt', packets: 'Pkt',
  rl: 'Coil', roll: 'Coil', rolls: 'Coil', coil: 'Coil', coils: 'Coil',
  set: 'Set', sets: 'Set', kg: 'Kg'
};

const SPEC_UNITS_REGEX = /(?:sqmm|sq\.mm|mm|amp|amps|a|watt|watts|w|volt|volts|v|kw|inch|")/i;

/**
 * Fixes common OCR character confusions strictly within numeric tokens.
 */
function fixNumericOcrErrors(str) {
  return str
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[bB]/g, '8');
}

/**
 * Checks if a line is a header, date, phone, or total rather than an item.
 */
function isNoiseLine(line) {
  const l = line.toLowerCase().trim();
  if (l.length < 2) return true;
  if (/^(total|grand total|subtotal|balance|date|bill|invoice|estimate|material list|materials|sl no|s\.no|item)/i.test(l)) {
    return true;
  }
  // Phone number or date check
  if (/^\+?\d{10,12}$/.test(l.replace(/\s/g, ''))) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(l)) return true;
  return false;
}

/**
 * Parses raw OCR text into structured lines.
 *
 * @param {string} rawText
 * @returns {Array<{ originalText: string, description: string, qty: number, unit: string, checkQty: boolean, specs: string[] }>}
 */
export function parseMaterialList(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }

  const rawLines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isNoiseLine(line));

  const items = [];

  for (const rawLine of rawLines) {
    // Strip leading list numbers like "1.", "1)", "1 - "
    let line = rawLine.replace(/^\d+[\s.)\-]+/, '').trim();
    if (!line) continue;

    let qty = 1;
    let unit = 'Nos';
    let checkQty = true; // flagged if default 1 was assumed
    const specs = [];

    // 1. Extract Electrical Specifications (e.g. 1.5 sqmm, 32A, 6A, 10W, 25mm) so they aren't parsed as quantities
    const specMatches = line.matchAll(/\b(\d+(?:\.\d+)?)\s*(sqmm|sq\.mm|mm|amps?|a|watts?|w|volts?|v|kw|inch|")\b/gi);
    for (const match of specMatches) {
      const fullSpec = match[0].toUpperCase().replace(/\s+/g, '');
      specs.push(fullSpec);
    }

    // Temporarily mask specifications to avoid confusing quantity extractor
    let workingLine = line;
    for (const spec of specs) {
      workingLine = workingLine.replace(new RegExp(spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '__SPEC__');
    }

    // Pattern A: Qty with Unit at the beginning (e.g. "2 coil 1.5 sqmm wire", "10 nos 6A switch")
    const leadingQtyUnitRegex = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\b/i;
    const leadingMatch = workingLine.match(leadingQtyUnitRegex);

    if (leadingMatch && KNOWN_UNITS.has(leadingMatch[2].toLowerCase())) {
      qty = parseFloat(leadingMatch[1]);
      unit = UNIT_SYNONYMS[leadingMatch[2].toLowerCase()] || 'Nos';
      checkQty = false;
      workingLine = workingLine.slice(leadingMatch[0].length).trim();
    } else {
      // Pattern B: Trailing Qty and Unit (e.g. "wire 1.5 sqmm - 2 coil", "6A switch 10 nos")
      const trailingQtyUnitRegex = /\b(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/i;
      const trailingMatch = workingLine.match(trailingQtyUnitRegex);

      if (trailingMatch && KNOWN_UNITS.has(trailingMatch[2].toLowerCase())) {
        qty = parseFloat(trailingMatch[1]);
        unit = UNIT_SYNONYMS[trailingMatch[2].toLowerCase()] || 'Nos';
        checkQty = false;
        workingLine = workingLine.slice(0, trailingMatch.index).trim();
      } else {
        // Pattern C: Parenthesized quantity (e.g. "MCB 32A (5)", "Switch (10)")
        const parenMatch = workingLine.match(/\((\d+)\)/);
        if (parenMatch) {
          qty = parseInt(parenMatch[1], 10);
          checkQty = false;
          workingLine = workingLine.replace(parenMatch[0], '').trim();
        } else {
          // Pattern D: "10 x Switch" or "Switch x 10"
          const xMatch = workingLine.match(/(?:^(\d+)\s*[xX]\s*|\s*[xX]\s*(\d+)$)/);
          if (xMatch) {
            qty = parseInt(xMatch[1] || xMatch[2], 10);
            checkQty = false;
            workingLine = workingLine.replace(xMatch[0], '').trim();
          } else {
            // Pattern E: Trailing isolated number at the end of line (e.g. "switch 6a 10")
            const trailingNumMatch = workingLine.match(/\s+(\d+)$/);
            if (trailingNumMatch) {
              qty = parseInt(trailingNumMatch[1], 10);
              checkQty = false;
              workingLine = workingLine.slice(0, trailingNumMatch.index).trim();
            }
          }
        }
      }
    }

    // Restore clean description
    let description = line;
    // Strip extracted qty and unit portions from clean description
    description = description
      .replace(new RegExp(`\\b${qty}\\s*${unit}\\b`, 'i'), '')
      .replace(new RegExp(`\\(${qty}\\)`, 'g'), '')
      .replace(/\s*-\s*$/, '')
      .replace(/^\s*-\s*/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!description) {
      description = line;
    }

    items.push({
      originalText: rawLine,
      description,
      qty: Math.max(0.001, qty),
      unit,
      checkQty,
      specs
    });
  }

  return items;
}

export default parseMaterialList;
