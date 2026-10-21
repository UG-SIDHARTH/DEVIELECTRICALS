import { z } from 'zod';
import config from '../config.js';
import { matchScannedItems } from './matcher.js';
import db from '../db/pool.js';

const aiResponseSchema = z.object({
  items: z.array(z.object({
    text: z.string().min(1),
    qty: z.number().positive().default(1),
    unit: z.string().default('Nos')
  }))
}).strict();

/**
 * Invokes optional external AI vision service to extract structured items from an image.
 * Never leaks the API key to client; treats AI response as untrusted data and strictly validates.
 *
 * @param {Buffer} imageBuffer - Cleaned WebP image buffer
 * @returns {Promise<Array>} Matched product draft lines
 */
export async function parseWithAiVision(imageBuffer) {
  if (!config.ai.apiKey) {
    throw new Error('AI scanning is not configured on this server');
  }

  const base64Data = imageBuffer.toString('base64');
  const provider = config.ai.provider || 'gemini';
  const model = config.ai.model || 'gemini-1.5-flash';

  const prompt = `
You are an expert electrician material list extractor for an electrical supply store in Kerala, India.
Analyze this handwritten or typed electrical materials list and extract each item.
Respond ONLY with a JSON object adhering exactly to this schema:
{
  "items": [
    {
      "text": "Full item description including spec e.g. 1.5 sqmm wire or 32A MCB",
      "qty": 2,
      "unit": "Coil or Nos or Mtr or Box"
    }
  ]
}
Do not include any Markdown ticks or explanatory text. Respond with raw JSON only.
`.trim();

  let rawJsonText = '';

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.ai.apiKey}`;
    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/webp', data: base64Data } }
        ]
      }],
      generationConfig: {
        response_mime_type: 'application/json'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`AI service responded with HTTP ${res.status}`);
    }

    const data = await res.json();
    rawJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else {
    throw new Error(`Unsupported AI vision provider: ${provider}`);
  }

  // Parse and validate strictly
  let parsedJson;
  try {
    parsedJson = JSON.parse(rawJsonText);
  } catch {
    throw new Error('AI returned non-JSON response');
  }

  const validated = aiResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new Error('AI response structure validation failed');
  }

  // Convert to scanParser output format
  const parsedItems = validated.data.items.map(item => ({
    originalText: `${item.qty} ${item.unit} ${item.text}`,
    description: item.text,
    qty: item.qty,
    unit: item.unit,
    checkQty: false,
    specs: []
  }));

  // Fetch catalog products and aliases to run through standard matcher
  const [prodsRes, aliasesRes] = await Promise.all([
    db.query('SELECT * FROM products'),
    db.query('SELECT * FROM product_aliases')
  ]);

  return matchScannedItems(parsedItems, prodsRes.rows, aliasesRes.rows);
}

export default {
  parseWithAiVision
};
