/**
 * Inventory and stock ledger management service.
 * Manages atomic stock updates, audit history, and negative stock rules.
 */

export async function applyDocumentStockChange(client, documentId, docType, lines, userId) {
  // Quotations and challans never alter physical stock levels
  if (docType === 'quotation' || docType === 'challan') {
    return;
  }

  // Fetch store setting on negative stock rule
  const settingsRes = await client.query('SELECT allow_negative_stock FROM settings WHERE id = 1');
  const allowNegative = settingsRes.rows[0]?.allow_negative_stock || false;

  const isSale = docType === 'invoice';
  const isPurchase = docType === 'purchase';

  for (const line of lines) {
    if (!line.productId) continue;

    const qty = Number(line.qty);
    if (qty <= 0) continue;

    // Acquire lock on the product row
    const prodRes = await client.query(
      'SELECT id, name, current_stock FROM products WHERE id = $1 FOR UPDATE',
      [line.productId]
    );

    if (prodRes.rows.length === 0) continue;

    const prod = prodRes.rows[0];
    const prevStock = Number(prod.current_stock);
    let delta = 0;
    let movementType = 'sale';

    if (isSale) {
      delta = -qty;
      movementType = 'sale';
    } else if (isPurchase) {
      delta = qty;
      movementType = 'purchase';
    }

    const nextStock = prevStock + delta;

    if (!allowNegative && nextStock < 0) {
      throw new Error(`Insufficient stock for product "${prod.name}". Available: ${prevStock}, requested: ${qty}. Negative stock is disabled in settings.`);
    }

    // Update current stock
    await client.query(
      'UPDATE products SET current_stock = $1, updated_at = NOW() WHERE id = $2',
      [nextStock, line.productId]
    );

    // Insert append-only movement entry
    await client.query(
      `INSERT INTO stock_movements (product_id, document_id, movement_type, qty, previous_stock, new_stock, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        line.productId,
        documentId,
        movementType,
        delta,
        prevStock,
        nextStock,
        `${docType.toUpperCase()} document finalized`,
        userId
      ]
    );
  }
}

export async function restoreDocumentStock(client, documentId, userId) {
  const docRes = await client.query(
    'SELECT doc_type FROM documents WHERE id = $1',
    [documentId]
  );
  if (docRes.rows.length === 0) return;

  const docType = docRes.rows[0].doc_type;
  if (docType === 'quotation' || docType === 'challan') {
    return;
  }

  const linesRes = await client.query(
    'SELECT product_id, qty FROM document_lines WHERE document_id = $1 AND product_id IS NOT NULL',
    [documentId]
  );

  for (const line of linesRes.rows) {
    const qty = Number(line.qty);
    const prodRes = await client.query(
      'SELECT current_stock FROM products WHERE id = $1 FOR UPDATE',
      [line.product_id]
    );
    if (prodRes.rows.length === 0) continue;

    const prevStock = Number(prodRes.rows[0].current_stock);
    // Reverse previous action: if sale, add back; if purchase, deduct
    const delta = docType === 'invoice' ? qty : -qty;
    const nextStock = prevStock + delta;

    await client.query(
      'UPDATE products SET current_stock = $1, updated_at = NOW() WHERE id = $2',
      [nextStock, line.product_id]
    );

    await client.query(
      `INSERT INTO stock_movements (product_id, document_id, movement_type, qty, previous_stock, new_stock, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        line.product_id,
        documentId,
        'cancel_restoration',
        delta,
        prevStock,
        nextStock,
        `Document cancelled: Stock restored`,
        userId
      ]
    );
  }
}

export async function adjustProductStock(client, productId, newStockQty, reason, userId) {
  const prodRes = await client.query(
    'SELECT current_stock FROM products WHERE id = $1 FOR UPDATE',
    [productId]
  );

  if (prodRes.rows.length === 0) {
    throw new Error('Product not found for stock adjustment');
  }

  const prevStock = Number(prodRes.rows[0].current_stock);
  const nextStock = Number(newStockQty);
  const delta = nextStock - prevStock;

  await client.query(
    'UPDATE products SET current_stock = $1, updated_at = NOW() WHERE id = $2',
    [nextStock, productId]
  );

  await client.query(
    `INSERT INTO stock_movements (product_id, movement_type, qty, previous_stock, new_stock, reason, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      productId,
      'adjustment',
      delta,
      prevStock,
      nextStock,
      reason || 'Manual stock adjustment',
      userId
    ]
  );

  return { previousStock: prevStock, newStock: nextStock, delta };
}

export default {
  applyDocumentStockChange,
  restoreDocumentStock,
  adjustProductStock
};
