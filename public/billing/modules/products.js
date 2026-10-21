import api from './api.js';
import { formatMoney, formatQty, showToast, confirmDialog } from './ui.js';
import { getState } from './state.js';

export async function renderProducts(container) {
  const isOwner = getState().currentUser?.role === 'owner';

  container.innerHTML = `
    <div class="space-y-6">
      <!-- Action Toolbar -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Product Database & Stock</h2>
          <p class="text-xs text-navy-500 font-medium">Catalog items, prices, GST rates, and physical stock levels</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button id="btn-export-csv" class="bg-white hover:bg-navy-50 text-navy border border-navy-200 px-3.5 py-2 rounded-xl text-xs font-bold shadow-card">
            Export CSV
          </button>
          <button id="btn-import-csv" class="bg-white hover:bg-navy-50 text-navy border border-navy-200 px-3.5 py-2 rounded-xl text-xs font-bold shadow-card">
            Import CSV
          </button>
          <button id="btn-add-product" class="bg-navy hover:bg-navy-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5">
            <span>+</span> Add Product
          </button>
        </div>
      </div>

      <!-- Filters & Search -->
      <div class="bg-white p-4 rounded-2xl border border-surface-border shadow-card flex flex-col sm:flex-row gap-3">
        <div class="flex-grow">
          <input type="text" id="prod-search-input" placeholder="Search by name, SKU, barcode, spec, or keyword..." class="w-full text-xs px-3.5 py-2.5 rounded-xl border border-navy-200 focus:outline-none focus:border-amber">
        </div>
        <div class="w-full sm:w-48">
          <select id="prod-category-filter" class="w-full text-xs px-3 py-2.5 rounded-xl border border-navy-200 bg-white">
            <option value="all">All Categories</option>
            <option value="Wires & Cables">Wires & Cables</option>
            <option value="Modular Switches & Sockets">Modular Switches & Sockets</option>
            <option value="LED & Decorative Lighting">LED & Decorative Lighting</option>
            <option value="Circuit Protection & Switchgear">Circuit Protection & Switchgear</option>
            <option value="Fans & Home Comfort">Fans & Home Comfort</option>
            <option value="Conduits, Pipes & Hardware Tools">Conduits, Pipes & Hardware Tools</option>
          </select>
        </div>
        <div class="w-full sm:w-40">
          <select id="prod-stock-filter" class="w-full text-xs px-3 py-2.5 rounded-xl border border-navy-200 bg-white">
            <option value="all">All Stock Levels</option>
            <option value="low">Low Stock Only</option>
            <option value="out">Out of Stock</option>
          </select>
        </div>
      </div>

      <!-- Products Data View Container -->
      <div id="products-table-wrapper" class="bg-white rounded-2xl border border-surface-border shadow-card overflow-hidden">
        <div class="p-8 text-center text-xs text-navy-400">Loading product inventory...</div>
      </div>

      <!-- Pagination Footer -->
      <div id="products-pagination" class="flex items-center justify-between text-xs px-2 text-navy-600"></div>
    </div>
  `;

  let currentPage = 1;

  async function loadProducts() {
    const search = container.querySelector('#prod-search-input').value.trim();
    const category = container.querySelector('#prod-category-filter').value;
    const stockFilter = container.querySelector('#prod-stock-filter').value;

    const wrapper = container.querySelector('#products-table-wrapper');
    const pagination = container.querySelector('#products-pagination');

    try {
      const data = await api.get(`/api/products?page=${currentPage}&limit=50&search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&stockFilter=${stockFilter}`);

      if (!data.items || data.items.length === 0) {
        wrapper.innerHTML = `
          <div class="p-12 text-center">
            <span class="text-4xl mb-3 block">📦</span>
            <h4 class="font-bold text-navy text-sm mb-1">Add your first product</h4>
            <p class="text-xs text-navy-500 max-w-sm mx-auto mb-4">Your store database is currently empty. Add products manually or import your catalog from a CSV file.</p>
            <button id="btn-empty-add" class="bg-navy text-white text-xs font-bold px-4 py-2.5 rounded-xl">Add Product</button>
          </div>
        `;
        wrapper.querySelector('#btn-empty-add')?.addEventListener('click', () => openProductDrawer());
        pagination.innerHTML = '';
        return;
      }

      // Render Table
      let tableHtml = `
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy-50 text-navy-700 uppercase font-bold text-[10px] tracking-wider border-b border-navy-200">
              <tr>
                <th class="py-3 px-4">Product / Spec</th>
                <th class="py-3 px-4">SKU / Barcode</th>
                <th class="py-3 px-4">Category</th>
                ${isOwner ? '<th class="py-3 px-4 text-right">Cost (₹)</th>' : ''}
                <th class="py-3 px-4 text-right">Selling Price</th>
                <th class="py-3 px-4 text-center">GST %</th>
                <th class="py-3 px-4 text-right">Stock</th>
                <th class="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-navy-100">
      `;

      for (const p of data.items) {
        const isLow = Number(p.current_stock) <= Number(p.min_stock);
        const stockBadgeClass = isLow ? 'text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded' : 'text-navy-700';

        tableHtml += `
          <tr class="hover:bg-navy-50/50 transition-colors">
            <td class="py-3 px-4">
              <span class="font-bold text-navy block">${p.name}</span>
              <span class="text-[11px] text-navy-500">${p.brand || ''} ${p.spec ? '• ' + p.spec : ''}</span>
            </td>
            <td class="py-3 px-4 text-navy-600 font-mono text-[11px]">
              ${p.sku}
              ${p.barcode ? '<span class="block text-navy-400">' + p.barcode + '</span>' : ''}
            </td>
            <td class="py-3 px-4 text-navy-600">${p.category}</td>
            ${isOwner ? `<td class="py-3 px-4 text-right font-medium text-navy-500">${formatMoney(p.purchase_price)}</td>` : ''}
            <td class="py-3 px-4 text-right font-bold text-navy">${formatMoney(p.selling_price)}</td>
            <td class="py-3 px-4 text-center font-medium">${p.gst_rate}%</td>
            <td class="py-3 px-4 text-right">
              <span class="${stockBadgeClass}">${formatQty(p.current_stock, p.unit)}</span>
            </td>
            <td class="py-3 px-4 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <button class="btn-adjust-stock p-1 hover:text-amber-dark text-navy-400" data-id="${p.id}" data-name="${p.name}" data-stock="${p.current_stock}" title="Adjust Stock">⚖️</button>
                <button class="btn-edit-prod p-1 hover:text-navy-900 text-navy-500" data-id="${p.id}" title="Edit">✏️</button>
                ${isOwner ? `<button class="btn-del-prod p-1 hover:text-rose-600 text-navy-400" data-id="${p.id}" title="Delete">🗑️</button>` : ''}
              </div>
            </td>
          </tr>
        `;
      }

      tableHtml += `</tbody></table></div>`;
      wrapper.innerHTML = tableHtml;

      // Attach row events
      wrapper.querySelectorAll('.btn-adjust-stock').forEach(btn => {
        btn.addEventListener('click', () => openStockAdjustDialog(btn.dataset.id, btn.dataset.name, btn.dataset.stock));
      });
      wrapper.querySelectorAll('.btn-edit-prod').forEach(btn => {
        btn.addEventListener('click', () => openProductDrawer(btn.dataset.id));
      });
      wrapper.querySelectorAll('.btn-del-prod').forEach(btn => {
        btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
      });

      // Pagination
      pagination.innerHTML = `
        <span>Showing page ${data.pagination.page} of ${data.pagination.totalPages} (${data.pagination.total} total products)</span>
        <div class="flex gap-2">
          <button id="btn-prev-page" class="px-3 py-1 rounded bg-white border border-navy-200" ${data.pagination.page <= 1 ? 'disabled' : ''}>Previous</button>
          <button id="btn-next-page" class="px-3 py-1 rounded bg-white border border-navy-200" ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''}>Next</button>
        </div>
      `;
      pagination.querySelector('#btn-prev-page')?.addEventListener('click', () => { currentPage--; loadProducts(); });
      pagination.querySelector('#btn-next-page')?.addEventListener('click', () => { currentPage++; loadProducts(); });

    } catch (err) {
      wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error loading products: ${err.message}</div>`;
    }
  }

  // Filter Event Listeners
  let searchTimer;
  container.querySelector('#prod-search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; loadProducts(); }, 300);
  });
  container.querySelector('#prod-category-filter').addEventListener('change', () => { currentPage = 1; loadProducts(); });
  container.querySelector('#prod-stock-filter').addEventListener('change', () => { currentPage = 1; loadProducts(); });

  // Add Product Button
  container.querySelector('#btn-add-product').addEventListener('click', () => openProductDrawer());

  // Export CSV
  container.querySelector('#btn-export-csv').addEventListener('click', () => {
    window.location.href = '/api/products/export/csv';
  });

  // Import CSV Dialog
  container.querySelector('#btn-import-csv').addEventListener('click', () => openCsvImportDialog(loadProducts));

  loadProducts();
}

async function openProductDrawer(productId = null) {
  const isOwner = getState().currentUser?.role === 'owner';
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  let product = {
    sku: `SKU-${Date.now().toString().slice(-6)}`,
    barcode: '',
    name: '',
    brand: '',
    category: 'Wires & Cables',
    spec: '',
    hsn: '',
    unit: 'Nos',
    purchase_price: 0,
    selling_price: 0,
    gst_rate: 18.00,
    current_stock: 0,
    min_stock: 0,
    rack_location: '',
    keywords: ''
  };

  if (productId) {
    try {
      product = await api.get(`/api/products/${productId}`);
    } catch (err) {
      showToast(err.message, 'error');
      modal.classList.add('hidden');
      return;
    }
  }

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-surface-border max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between pb-4 border-b border-navy-100 mb-6">
        <h3 class="text-lg font-bold text-navy">${productId ? 'Edit Product' : 'Add New Product'}</h3>
        <button id="modal-close" class="text-navy-400 hover:text-navy text-lg font-bold">✕</button>
      </div>

      <form id="product-form" class="space-y-4 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Product Name *</label>
            <input type="text" id="f-name" required value="${product.name}" placeholder="e.g. 1.5 sqmm FR PVC Copper Wire" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">SKU / Item Code *</label>
            <input type="text" id="f-sku" required value="${product.sku}" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200 font-mono">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Category *</label>
            <select id="f-category" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200 bg-white">
              <option ${product.category === 'Wires & Cables' ? 'selected' : ''}>Wires & Cables</option>
              <option ${product.category === 'Modular Switches & Sockets' ? 'selected' : ''}>Modular Switches & Sockets</option>
              <option ${product.category === 'LED & Decorative Lighting' ? 'selected' : ''}>LED & Decorative Lighting</option>
              <option ${product.category === 'Circuit Protection & Switchgear' ? 'selected' : ''}>Circuit Protection & Switchgear</option>
              <option ${product.category === 'Fans & Home Comfort' ? 'selected' : ''}>Fans & Home Comfort</option>
              <option ${product.category === 'Conduits, Pipes & Hardware Tools' ? 'selected' : ''}>Conduits, Pipes & Hardware Tools</option>
            </select>
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">Size / Spec</label>
            <input type="text" id="f-spec" value="${product.spec || ''}" placeholder="e.g. 1.5 sqmm or 32A" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">Brand</label>
            <input type="text" id="f-brand" value="${product.brand || ''}" placeholder="e.g. Havells, Legrand" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Barcode (EAN/UPC)</label>
            <input type="text" id="f-barcode" value="${product.barcode || ''}" placeholder="Scan barcode..." class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200 font-mono">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">HSN Code (4, 6, 8 digits)</label>
            <input type="text" id="f-hsn" value="${product.hsn || ''}" placeholder="e.g. 8544" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200 font-mono">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">Unit of Measure *</label>
            <select id="f-unit" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200 bg-white">
              <option ${product.unit === 'Nos' ? 'selected' : ''}>Nos</option>
              <option ${product.unit === 'Mtr' ? 'selected' : ''}>Mtr</option>
              <option ${product.unit === 'Coil' ? 'selected' : ''}>Coil</option>
              <option ${product.unit === 'Box' ? 'selected' : ''}>Box</option>
              <option ${product.unit === 'Set' ? 'selected' : ''}>Set</option>
              <option ${product.unit === 'Kg' ? 'selected' : ''}>Kg</option>
              <option ${product.unit === 'Pkt' ? 'selected' : ''}>Pkt</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-navy-100">
          ${isOwner ? `
            <div>
              <label class="block font-bold text-navy-700 mb-1">Purchase Price (₹)</label>
              <input type="number" step="0.01" id="f-purchase-price" value="${(product.purchase_price / 100).toFixed(2)}" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
            </div>
          ` : ''}
          <div>
            <label class="block font-bold text-navy-700 mb-1">Selling Price (₹) *</label>
            <input type="number" step="0.01" required id="f-selling-price" value="${(product.selling_price / 100).toFixed(2)}" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200 font-bold">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">GST Rate % *</label>
            <input type="number" step="0.5" id="f-gst-rate" value="${product.gst_rate}" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Current Stock Qty</label>
            <input type="number" step="any" id="f-current-stock" value="${product.current_stock}" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">Minimum Alert Level</label>
            <input type="number" step="any" id="f-min-stock" value="${product.min_stock}" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">Rack / Shelf Location</label>
            <input type="text" id="f-rack" value="${product.rack_location || ''}" placeholder="e.g. A2-Top" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
          </div>
        </div>

        <div>
          <label class="block font-bold text-navy-700 mb-1">Keywords / Alternate Names</label>
          <input type="text" id="f-keywords" value="${product.keywords || ''}" placeholder="e.g. copper wire red 1.5, havels wire" class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200">
        </div>

        <div id="price-warning" class="hidden p-3 bg-amber-light/30 border border-amber text-navy font-semibold rounded-xl text-xs">
          ⚠️ Warning: Selling price is lower than purchase cost.
        </div>

        <div class="flex justify-end gap-3 pt-4 border-t border-navy-100">
          <button type="button" id="btn-cancel-drawer" class="px-4 py-2 border border-navy-200 rounded-xl text-navy font-semibold">Cancel</button>
          <button type="submit" class="px-5 py-2 bg-navy text-white font-bold rounded-xl shadow-card">Save Product</button>
        </div>
      </form>
    </div>
  `;

  const closeBtn = modal.querySelector('#modal-close');
  const cancelBtn = modal.querySelector('#btn-cancel-drawer');
  const form = modal.querySelector('#product-form');

  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const sellRupees = parseFloat(form.querySelector('#f-selling-price').value) || 0;
    const purRupees = isOwner ? (parseFloat(form.querySelector('#f-purchase-price')?.value) || 0) : 0;

    if (isOwner && sellRupees < purRupees) {
      const proceed = await confirmDialog({
        title: 'Low Selling Price Warning',
        message: `Selling price (₹${sellRupees}) is below your cost price (₹${purRupees}). Do you want to save anyway?`,
        confirmText: 'Save Anyway'
      });
      if (!proceed) return;
    }

    const payload = {
      sku: form.querySelector('#f-sku').value.trim(),
      barcode: form.querySelector('#f-barcode').value.trim() || null,
      name: form.querySelector('#f-name').value.trim(),
      brand: form.querySelector('#f-brand').value.trim() || null,
      category: form.querySelector('#f-category').value,
      spec: form.querySelector('#f-spec').value.trim() || null,
      hsn: form.querySelector('#f-hsn').value.trim() || null,
      unit: form.querySelector('#f-unit').value,
      selling_price: Math.round(sellRupees * 100), // paise
      gst_rate: parseFloat(form.querySelector('#f-gst-rate').value) || 18,
      current_stock: parseFloat(form.querySelector('#f-current-stock').value) || 0,
      min_stock: parseFloat(form.querySelector('#f-min-stock').value) || 0,
      rack_location: form.querySelector('#f-rack').value.trim() || null,
      keywords: form.querySelector('#f-keywords').value.trim() || null
    };

    if (isOwner) {
      payload.purchase_price = Math.round(purRupees * 100);
    }

    try {
      if (productId) {
        await api.put(`/api/products/${productId}`, payload);
        showToast('Product updated successfully', 'success');
      } else {
        await api.post('/api/products', payload);
        showToast('Product created successfully', 'success');
      }
      modal.classList.add('hidden');
      renderProducts(document.querySelector('#billing-content'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function openStockAdjustDialog(productId, name, currentStock) {
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-border">
      <h3 class="text-base font-bold text-navy mb-1">Adjust Inventory Stock</h3>
      <p class="text-xs text-navy-500 mb-4">${name} (Current: ${currentStock})</p>

      <form id="stock-adjust-form" class="space-y-4 text-xs">
        <div>
          <label class="block font-bold text-navy-700 mb-1">New Actual Count *</label>
          <input type="number" step="any" id="f-adj-stock" required value="${currentStock}" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Reason for Adjustment *</label>
          <input type="text" id="f-adj-reason" required placeholder="e.g. Physical inventory count correction" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="btn-adj-cancel" class="px-3 py-2 border border-navy-200 rounded-xl font-semibold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-navy text-white font-bold rounded-xl">Save Count</button>
        </div>
      </form>
    </div>
  `;

  modal.querySelector('#btn-adj-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  modal.querySelector('#stock-adjust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newStock = parseFloat(modal.querySelector('#f-adj-stock').value);
    const reason = modal.querySelector('#f-adj-reason').value.trim();

    try {
      await api.post('/api/stock/adjust', {
        productId,
        newStock,
        reason
      });
      showToast('Stock adjusted successfully', 'success');
      modal.classList.add('hidden');
      renderProducts(document.querySelector('#billing-content'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function deleteProduct(productId) {
  const confirmed = await confirmDialog({
    title: 'Delete Product',
    message: 'Are you sure you want to delete this product? This action cannot be undone if no transactions exist.',
    confirmText: 'Delete',
    isDestructive: true
  });

  if (confirmed) {
    try {
      await api.del(`/api/products/${productId}`);
      showToast('Product deleted', 'success');
      renderProducts(document.querySelector('#billing-content'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}

function openCsvImportDialog(onSuccess) {
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-surface-border text-xs">
      <h3 class="text-base font-bold text-navy mb-2">Import Products from CSV</h3>
      <p class="text-navy-500 mb-4 leading-relaxed">
        Upload a standard CSV file with headers: <code>sku, name, brand, category, spec, hsn, unit, selling_price, gst_rate, current_stock</code>.
      </p>

      <input type="file" id="f-csv-file" accept=".csv" class="mb-4 w-full">

      <div class="flex justify-end gap-2">
        <button id="btn-csv-cancel" class="px-3 py-2 border border-navy-200 rounded-xl font-semibold">Cancel</button>
        <button id="btn-csv-upload" class="px-4 py-2 bg-navy text-white font-bold rounded-xl">Parse & Import</button>
      </div>
    </div>
  `;

  modal.querySelector('#btn-csv-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  modal.querySelector('#btn-csv-upload').addEventListener('click', () => {
    const file = modal.querySelector('#f-csv-file').files[0];
    if (!file) {
      showToast('Please select a CSV file', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) {
        showToast('CSV file is empty or missing data rows', 'error');
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const items = [];

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(p => p.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = parts[idx] || '';
        });
        if (obj.name) items.push(obj);
      }

      try {
        const res = await api.post('/api/products/import', { items });
        showToast(`Imported ${res.importedCount} products successfully!`, 'success');
        modal.classList.add('hidden');
        onSuccess();
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
    reader.readAsText(file);
  });
}

export default {
  renderProducts
};
