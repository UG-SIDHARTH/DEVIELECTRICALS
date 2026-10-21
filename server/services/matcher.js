/**
 * Product Matcher with strict electrical spec enforcement and fuzzy token scoring.
 */

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
}

function extractSpecs(text) {
  if (!text) return [];
  const matches = text.matchAll(/\b(\d+(?:\.\d+)?)\s*(sqmm|sq\.mm|mm|a|amps?|w|watts?|v|volts?|kw|inch)\b/gi);
  const specs = [];
  for (const m of matches) {
    const unit = m[2].toLowerCase()
      .replace('sq.mm', 'sqmm')
      .replace('amps', 'a')
      .replace('amp', 'a')
      .replace('watts', 'w')
      .replace('watt', 'w')
      .replace('volts', 'v')
      .replace('volt', 'v');
    specs.push(`${m[1]}${unit}`);
  }
  return specs;
}

function jaroWinkler(s1, s2) {
  let m = 0;
  if (s1.length === 0 || s2.length === 0) return 0;
  if (s1 === s2) return 1;

  const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  for (let i = 0; i < s1.length; i++) {
    const low = Math.max(0, i - range);
    const high = Math.min(i + range + 1, s2.length);
    for (let j = low; j < high; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        m++;
        break;
      }
    }
  }

  if (m === 0) return 0;

  let k = 0;
  let numTrans = 0;
  for (let i = 0; i < s1.length; i++) {
    if (s1Matches[i]) {
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) numTrans++;
      k++;
    }
  }

  let weight = (m / s1.length + m / s2.length + (m - numTrans / 2) / m) / 3;
  let l = 0;
  while (l < Math.min(4, Math.min(s1.length, s2.length)) && s1[l] === s2[l]) {
    l++;
  }

  return weight + 0.1 * l * (1 - weight);
}

/**
 * Computes match score between query and a catalog product.
 * CRITICAL RULE: If electrical specs (e.g. 32A vs 16A or 1.5sqmm vs 2.5sqmm) conflict, score is ZERO.
 */
export function scoreProductMatch(queryText, product, aliases = []) {
  const querySpecs = extractSpecs(queryText);
  const productSpecs = extractSpecs(`${product.spec || ''} ${product.name} ${product.keywords || ''}`);

  // Strict Spec Rule: If query specifies ampere/gauge/wattage, product MUST match or have no conflicting spec
  if (querySpecs.length > 0 && productSpecs.length > 0) {
    for (const qSpec of querySpecs) {
      // Check if product contains a different value for the same unit family
      const unitType = qSpec.replace(/^[0-9.]+/, '');
      const conflictingProductSpec = productSpecs.find(pSpec =>
        pSpec.endsWith(unitType) && pSpec !== qSpec
      );

      if (conflictingProductSpec) {
        // Hard failure: Spec mismatch (e.g. 32A requested vs 16A product)
        return 0;
      }
    }
  }

  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return 0;

  const productTokens = tokenize(`${product.name} ${product.brand || ''} ${product.spec || ''} ${product.sku} ${product.keywords || ''}`);

  // 1. Direct Alias Match
  for (const alias of aliases) {
    if (alias.toLowerCase() === queryText.toLowerCase().trim()) {
      return 1.0;
    }
    const aliasSim = jaroWinkler(alias.toLowerCase(), queryText.toLowerCase());
    if (aliasSim > 0.9) return 0.95;
  }

  // 2. Token overlap ratio
  let matchedTokens = 0;
  for (const qToken of queryTokens) {
    if (productTokens.some(pToken => pToken === qToken || jaroWinkler(qToken, pToken) > 0.85)) {
      matchedTokens++;
    }
  }

  const tokenScore = matchedTokens / queryTokens.length;

  // 3. String-level overall similarity
  const stringSim = jaroWinkler(queryText.toLowerCase(), product.name.toLowerCase());

  // Weighted overall score
  let totalScore = (tokenScore * 0.7) + (stringSim * 0.3);

  // Bonus for matching specs
  if (querySpecs.length > 0 && productSpecs.length > 0) {
    const hasExactSpec = querySpecs.some(qs => productSpecs.includes(qs));
    if (hasExactSpec) {
      totalScore = Math.min(1.0, totalScore + 0.15);
    }
  }

  return totalScore;
}

/**
 * Matches an array of parsed scanned items against catalog products.
 *
 * @param {Array} parsedItems - From scanParser.js
 * @param {Array} allProducts - Catalog products with stock
 * @param {Array} allAliases - Product aliases
 * @returns {Array} Items enriched with product matches, confidence tiers, and alternatives
 */
export function matchScannedItems(parsedItems, allProducts, allAliases = []) {
  const aliasMap = new Map();
  for (const a of allAliases) {
    if (!aliasMap.has(a.product_id)) aliasMap.set(a.product_id, []);
    aliasMap.get(a.product_id).push(a.alias);
  }

  return parsedItems.map(item => {
    const candidates = [];

    for (const prod of allProducts) {
      const aliases = aliasMap.get(prod.id) || [];
      const score = scoreProductMatch(item.description, prod, aliases);
      if (score >= 0.35) {
        candidates.push({ product: prod, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const top = candidates[0];

    let confidence = 'not_found';
    let matchedProduct = null;

    if (top && top.score >= 0.8) {
      confidence = 'matched';
      matchedProduct = top.product;
    } else if (top && top.score >= 0.4) {
      confidence = 'check';
      matchedProduct = top.product;
    }

    return {
      originalText: item.originalText,
      description: item.description,
      qty: item.qty,
      unit: item.unit,
      checkQty: item.checkQty,
      confidence,
      matchedProduct: matchedProduct ? {
        id: matchedProduct.id,
        name: matchedProduct.name,
        sku: matchedProduct.sku,
        sellingPrice: matchedProduct.selling_price,
        gstRate: matchedProduct.gst_rate,
        currentStock: Number(matchedProduct.current_stock),
        unit: matchedProduct.unit
      } : null,
      suggestions: candidates.slice(0, 3).map(c => ({
        id: c.product.id,
        name: c.product.name,
        sku: c.product.sku,
        sellingPrice: c.product.selling_price,
        gstRate: c.product.gst_rate,
        currentStock: Number(c.product.current_stock),
        score: Math.round(c.score * 100)
      }))
    };
  });
}

export default {
  scoreProductMatch,
  matchScannedItems
};
