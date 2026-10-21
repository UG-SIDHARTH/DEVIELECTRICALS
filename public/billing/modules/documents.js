import api from './api.js';
import { formatMoney, formatQty, formatDate, showToast, confirmDialog } from './ui.js';
import { getState, setRoute } from './state.js';
import { printDocument } from './print.js';

let hasUnsavedChanges = false;
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

export async function renderDocuments(container, params = {}) {
  if (params.mode === 'create') {
    return renderDocumentEditor(container, null, params.docType || 'invoice');
  }
  if (params.mode === 'edit' && params.docId) {
    return renderDocumentEditor(container, params.docId);
  }
  if (params.mode === 'view' && params.docId) {
    return renderDocumentDetail(container, params.docId);
  }

  // Document List View
  const isOwner = getState().currentUser?.role === 'owner';

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Documents & Billing</h2>
          <p class="text-xs text-navy-500 font-medium">Invoices, quotations, delivery challans, and counter bills</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-new-quote" class="bg-white hover:bg-navy-50 text-navy border border-navy-200 px-3.5 py-2 rounded-xl text-xs font-bold shadow-card">
            + New Quotation
          </button>
          <button id="btn-new-invoice" class="bg-navy hover:bg-navy-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card">
            + New Invoice
          </button>
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-white p-4 rounded-2xl border border-surface-border shadow-card flex flex-col sm:flex-row gap-3">
        <div class="flex-grow">
          <input type="text" id="doc-search" placeholder="Search by document number or customer..." class="w-full text-xs px-3.5 py-2.5 rounded-xl border border-navy-200">
        </div>
        <div class="w-full sm:w-40">
          <select id="doc-type-filter" class="w-full text-xs px-3 py-2.5 rounded-xl border border-navy-200 bg-white">
            <option value="all">All Types</option>
            <option value="invoice">Invoices</option>
            <option value="quotation">Quotations</option>
            <option value="challan">Delivery Challans</option>
            <option value="purchase">Purchase Entries</option>
          </select>
        </div>
        <div class="w-full sm:w-40">
          <select id="doc-status-filter" class="w-full text-xs px-3 py-2.5 rounded-xl border border-navy-200 bg-white">
            <option value="all">All Statuses</option>
            <option value="draft">Drafts</option>
            <option value="unpaid">Unpaid</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <!-- Document Table -->
      <div id="docs-table-wrapper" class="bg-white rounded-2xl border border-surface-border shadow-card overflow-hidden">
        <div class="p-8 text-center text-xs text-navy-400">Loading documents...</div>
      </div>

      <div id="docs-pagination" class="flex items-center justify-between text-xs px-2 text-navy-600"></div>
    </div>
  `;

  container.querySelector('#btn-new-invoice').addEventListener('click', () => setRoute('documents', { mode: 'create', docType: 'invoice' }));
  container.querySelector('#btn-new-quote').addEventListener('click', () => setRoute('documents', { mode: 'create', docType: 'quotation' }));

  let currentPage = 1;

  async function loadDocuments() {
    const search = container.querySelector('#doc-search').value.trim();
    const type = container.querySelector('#doc-type-filter').value;
    const status = container.querySelector('#doc-status-filter').value;
    const wrapper = container.querySelector('#docs-table-wrapper');
    const pagination = container.querySelector('#docs-pagination');

    try {
      const data = await api.get(`/api/documents?page=${currentPage}&limit=50&search=${encodeURIComponent(search)}&type=${type}&status=${status}`);

      if (!data.items || data.items.length === 0) {
        wrapper.innerHTML = `
          <div class="p-12 text-center">
            <span class="text-4xl mb-3 block">📄</span>
            <h4 class="font-bold text-navy text-sm mb-1">No documents found</h4>
            <p class="text-xs text-navy-500 mb-4">Create your first invoice or quotation to get started.</p>
          </div>
        `;
        pagination.innerHTML = '';
        return;
      }

      let html = `
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy-50 text-navy-700 uppercase font-bold text-[10px] tracking-wider border-b border-navy-200">
              <tr>
                <th class="py-3 px-4">Doc # / Date</th>
                <th class="py-3 px-4">Type</th>
                <th class="py-3 px-4">Customer / Supplier</th>
                <th class="py-3 px-4 text-right">Taxable</th>
                <th class="py-3 px-4 text-right">Total Amount</th>
                <th class="py-3 px-4 text-right">Balance Due</th>
                <th class="py-3 px-4 text-center">Status</th>
                <th class="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-navy-100">
      `;

      for (const d of data.items) {
        const balance = d.grand_total - d.paid_amount;
        const statusBadge = d.status === 'paid'
          ? 'bg-emerald/10 text-emerald-dark'
          : (d.status === 'cancelled' ? 'bg-rose-100 text-rose-700' : 'bg-amber-light/30 text-navy font-bold');

        html += `
          <tr class="hover:bg-navy-50/50 transition-colors">
            <td class="py-3 px-4">
              <span class="font-bold text-navy block">${d.doc_number || '(Draft)'}</span>
              <span class="text-[11px] text-navy-500">${formatDate(d.doc_date)}</span>
            </td>
            <td class="py-3 px-4 font-semibold uppercase text-[10px] text-navy-600">${d.doc_type}</td>
            <td class="py-3 px-4 font-medium">${d.customer_name || d.supplier_name || 'Walk-in'}</td>
            <td class="py-3 px-4 text-right text-navy-500">${formatMoney(d.taxable_amount)}</td>
            <td class="py-3 px-4 text-right font-bold text-navy">${formatMoney(d.grand_total)}</td>
            <td class="py-3 px-4 text-right ${balance > 0 ? 'text-rose-600 font-bold' : 'text-emerald-dark font-medium'}">${formatMoney(balance)}</td>
            <td class="py-3 px-4 text-center">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusBadge}">${d.status}</span>
            </td>
            <td class="py-3 px-4 text-center">
              <div class="flex items-center justify-center gap-1.5">
                <button class="btn-view-doc px-2 py-1 rounded bg-navy-50 hover:bg-navy-100 font-bold text-navy" data-id="${d.id}">View</button>
                <button class="btn-print-doc px-2 py-1 rounded bg-navy-50 hover:bg-navy-100 font-bold text-navy" data-id="${d.id}">🖨️</button>
              </div>
            </td>
          </tr>
        `;
      }

      html += `</tbody></table></div>`;
      wrapper.innerHTML = html;

      wrapper.querySelectorAll('.btn-view-doc').forEach(btn => {
        btn.addEventListener('click', () => setRoute('documents', { mode: 'view', docId: btn.dataset.id }));
      });
      wrapper.querySelectorAll('.btn-print-doc').forEach(btn => {
        btn.addEventListener('click', async () => {
          const doc = await api.get(`/api/documents/${btn.dataset.id}`);
          printDocument(doc);
        });
      });

      pagination.innerHTML = `
        <span>Showing page ${data.pagination.page} of ${data.pagination.totalPages}</span>
        <div class="flex gap-2">
          <button id="btn-doc-prev" class="px-3 py-1 rounded bg-white border border-navy-200" ${data.pagination.page <= 1 ? 'disabled' : ''}>Previous</button>
          <button id="btn-doc-next" class="px-3 py-1 rounded bg-white border border-navy-200" ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''}>Next</button>
        </div>
      `;
      pagination.querySelector('#btn-doc-prev')?.addEventListener('click', () => { currentPage--; loadDocuments(); });
      pagination.querySelector('#btn-doc-next')?.addEventListener('click', () => { currentPage++; loadDocuments(); });

    } catch (err) {
      wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
    }
  }

  container.querySelector('#doc-search').addEventListener('input', () => { currentPage = 1; loadDocuments(); });
  container.querySelector('#doc-type-filter').addEventListener('change', () => { currentPage = 1; loadDocuments(); });
  container.querySelector('#doc-status-filter').addEventListener('change', () => { currentPage = 1; loadDocuments(); });

  loadDocuments();
}

/**
 * Detailed Document View
 */
async function renderDocumentDetail(container, docId) {
  const isOwner = getState().currentUser?.role === 'owner';
  try {
    const doc = await api.get(`/api/documents/${docId}`);

    const isFinalized = !!doc.doc_number;
    const canCancel = isOwner && doc.status !== 'cancelled';

    container.innerHTML = `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <button id="btn-back-docs" class="p-2 rounded-xl bg-white border border-navy-200 hover:bg-navy-50 font-bold">← Back</button>
            <div>
              <h2 class="text-2xl font-black text-navy tracking-tight">${doc.doc_number || '(Draft ' + doc.doc_type + ')'}</h2>
              <span class="text-xs text-navy-500">${formatDate(doc.doc_date)} • ${doc.doc_type.toUpperCase()}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${!isFinalized ? `
              <button id="btn-finalize-doc" class="bg-emerald-dark hover:bg-emerald text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card">
                Finalize Document
              </button>
            ` : ''}
            <button id="btn-print-view" class="bg-navy hover:bg-navy-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5">
              <span>🖨️</span> Print / PDF
            </button>
            <button id="btn-share-wa" class="bg-emerald-dark text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5">
              <span>💬</span> WhatsApp
            </button>
            ${doc.doc_type === 'quotation' ? `
              <button id="btn-convert-inv" class="bg-amber hover:bg-amber-light text-navy px-3.5 py-2 rounded-xl text-xs font-bold shadow-card">
                Convert to Invoice
              </button>
            ` : ''}
            ${canCancel ? `
              <button id="btn-cancel-doc" class="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3.5 py-2 rounded-xl text-xs font-bold">
                Cancel Document
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Document Details Card -->
        <div class="bg-white rounded-2xl border border-surface-border p-6 shadow-card space-y-6">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs pb-6 border-b border-navy-100">
            <div>
              <span class="text-navy-400 font-bold uppercase tracking-wider block mb-1">Customer / Bill-to</span>
              <span class="font-bold text-navy text-sm block">${doc.customer_name || 'Walk-in Customer'}</span>
              ${doc.customer_snapshot?.phone ? `<span class="text-navy-500 block">${doc.customer_snapshot.phone}</span>` : ''}
              ${doc.customer_snapshot?.gstin ? `<span class="text-navy-500 block font-mono">GSTIN: ${doc.customer_snapshot.gstin}</span>` : ''}
            </div>
            <div>
              <span class="text-navy-400 font-bold uppercase tracking-wider block mb-1">Place of Supply</span>
              <span class="font-bold text-navy">${doc.place_of_supply === '32' ? 'Kerala (32)' : `State ${doc.place_of_supply}`}</span>
              <span class="text-navy-500 block">${doc.is_interstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</span>
            </div>
            <div>
              <span class="text-navy-400 font-bold uppercase tracking-wider block mb-1">Status</span>
              <span class="px-2.5 py-1 rounded-full text-[11px] font-bold uppercase inline-block bg-navy-100 text-navy">${doc.status}</span>
            </div>
            <div>
              <span class="text-navy-400 font-bold uppercase tracking-wider block mb-1">Payment Status</span>
              <span class="font-bold text-navy block text-sm">${formatMoney(doc.paid_amount)} of ${formatMoney(doc.grand_total)}</span>
              ${doc.grand_total - doc.paid_amount > 0 ? `<button id="btn-add-payment" class="mt-2 text-xs font-bold text-amber-dark hover:underline">+ Record Payment</button>` : ''}
            </div>
          </div>

          <!-- Items Table -->
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-navy-50 text-navy-700 uppercase font-bold text-[10px] tracking-wider border-b border-navy-200">
                <tr>
                  <th class="py-3 px-4">#</th>
                  <th class="py-3 px-4">Description</th>
                  <th class="py-3 px-4">HSN</th>
                  <th class="py-3 px-4 text-right">Qty</th>
                  <th class="py-3 px-4 text-right">Rate</th>
                  <th class="py-3 px-4 text-right">Discount</th>
                  <th class="py-3 px-4 text-right">Taxable</th>
                  <th class="py-3 px-4 text-center">GST %</th>
                  <th class="py-3 px-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-navy-100">
                ${doc.lines.map((l, i) => `
                  <tr>
                    <td class="py-3 px-4 text-navy-400">${i + 1}</td>
                    <td class="py-3 px-4 font-bold text-navy">${l.description}</td>
                    <td class="py-3 px-4 font-mono text-navy-500">${l.hsn || '-'}</td>
                    <td class="py-3 px-4 text-right font-medium">${formatQty(l.qty, l.unit)}</td>
                    <td class="py-3 px-4 text-right font-medium">${formatMoney(l.rate)}</td>
                    <td class="py-3 px-4 text-right text-navy-500">${formatMoney(l.discount_amount)}</td>
                    <td class="py-3 px-4 text-right font-medium">${formatMoney(l.taxable_amount)}</td>
                    <td class="py-3 px-4 text-center">${l.gst_rate}%</td>
                    <td class="py-3 px-4 text-right font-bold text-navy">${formatMoney(l.line_total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Totals Panel -->
          <div class="flex justify-end pt-4 border-t border-navy-100">
            <div class="w-full sm:w-80 space-y-2 text-xs">
              <div class="flex justify-between text-navy-600">
                <span>Taxable Value:</span>
                <span class="font-bold">${formatMoney(doc.taxable_amount)}</span>
              </div>
              ${doc.cgst_amount > 0 ? `
                <div class="flex justify-between text-navy-600">
                  <span>CGST:</span>
                  <span class="font-bold">${formatMoney(doc.cgst_amount)}</span>
                </div>
                <div class="flex justify-between text-navy-600">
                  <span>SGST:</span>
                  <span class="font-bold">${formatMoney(doc.sgst_amount)}</span>
                </div>
              ` : ''}
              ${doc.igst_amount > 0 ? `
                <div class="flex justify-between text-navy-600">
                  <span>IGST:</span>
                  <span class="font-bold">${formatMoney(doc.igst_amount)}</span>
                </div>
              ` : ''}
              ${doc.extra_charges > 0 ? `
                <div class="flex justify-between text-navy-600">
                  <span>Extra Charges:</span>
                  <span class="font-bold">${formatMoney(doc.extra_charges)}</span>
                </div>
              ` : ''}
              ${doc.round_off !== 0 ? `
                <div class="flex justify-between text-navy-600">
                  <span>Round Off:</span>
                  <span class="font-bold">${formatMoney(doc.round_off)}</span>
                </div>
              ` : ''}
              <div class="flex justify-between text-base font-black text-navy pt-2 border-t border-navy-200">
                <span>Grand Total:</span>
                <span>${formatMoney(doc.grand_total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btn-back-docs').addEventListener('click', () => setRoute('documents'));
    container.querySelector('#btn-print-view').addEventListener('click', () => printDocument(doc));
    container.querySelector('#btn-share-wa').addEventListener('click', () => {
      const summary = `Devi Electrical ${doc.doc_type.toUpperCase()} #${doc.doc_number || 'Draft'}\nDate: ${formatDate(doc.doc_date)}\nTotal: ${formatMoney(doc.grand_total)}\nBalance Due: ${formatMoney(doc.grand_total - doc.paid_amount)}`;
      const phone = doc.customer_snapshot?.phone?.replace(/\D/g, '') || '';
      const url = `https://wa.me/${phone ? '91' + phone.slice(-10) : ''}?text=${encodeURIComponent(summary)}`;
      window.open(url, '_blank');
    });

    if (!isFinalized) {
      container.querySelector('#btn-finalize-doc')?.addEventListener('click', async () => {
        try {
          const res = await api.post(`/api/documents/${docId}/finalize`);
          showToast(`Finalized as ${res.doc_number}`, 'success');
          renderDocumentDetail(container, docId);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    if (canCancel) {
      container.querySelector('#btn-cancel-doc')?.addEventListener('click', async () => {
        const conf = await confirmDialog({
          title: 'Cancel Document',
          message: 'Cancelling will restore physical inventory stock. The document number will be preserved as Cancelled. Proceed?',
          confirmText: 'Cancel Document',
          isDestructive: true
        });
        if (conf) {
          try {
            await api.post(`/api/documents/${docId}/cancel`);
            showToast('Document cancelled and stock restored', 'success');
            renderDocumentDetail(container, docId);
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      });
    }

    if (doc.doc_type === 'quotation') {
      container.querySelector('#btn-convert-inv')?.addEventListener('click', async () => {
        try {
          const inv = await api.post(`/api/documents/${docId}/convert`);
          showToast('Converted to Invoice Draft', 'success');
          setRoute('documents', { mode: 'view', docId: inv.id });
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    container.querySelector('#btn-add-payment')?.addEventListener('click', () => openPaymentModal(doc, () => renderDocumentDetail(container, docId)));

  } catch (err) {
    container.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
  }
}

/**
 * Document Editor (Interactive Bill / Quotation Creation)
 */
async function renderDocumentEditor(container, docId = null, docType = 'invoice') {
  hasUnsavedChanges = true;
  const isOwner = getState().currentUser?.role === 'owner';

  let items = [];
  let selectedCustomer = null;

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button id="btn-editor-back" class="p-2 rounded-xl bg-white border border-navy-200 hover:bg-navy-50 font-bold">← Back</button>
          <div>
            <h2 class="text-2xl font-black text-navy tracking-tight">${docId ? 'Edit Draft' : 'New ' + (docType === 'quotation' ? 'Quotation' : 'Invoice / Bill')}</h2>
            <span class="text-xs text-navy-500 font-medium">Draft auto-computes taxes and previews grand total</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-save-draft" class="bg-white hover:bg-navy-50 text-navy border border-navy-200 px-4 py-2 rounded-xl text-xs font-bold shadow-card">
            Save Draft
          </button>
          <button id="btn-save-finalize" class="bg-navy hover:bg-navy-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card">
            Finalize & Allocate Number
          </button>
        </div>
      </div>

      <!-- Customer Bar & Options -->
      <div class="bg-white rounded-2xl border border-surface-border p-5 shadow-card grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Customer / Client</label>
          <div class="flex gap-2">
            <input type="text" id="cust-search-input" placeholder="Search customer or type Walk-in..." class="flex-grow px-3 py-2 rounded-xl border border-navy-200">
            <button type="button" id="btn-inline-add-cust" class="px-2.5 py-2 bg-navy-100 font-bold rounded-xl text-navy">+</button>
          </div>
          <div id="cust-search-results" class="relative hidden"></div>
        </div>

        <div>
          <label class="block font-bold text-navy-700 mb-1">Place of Supply (State)</label>
          <select id="doc-pos" class="w-full px-3 py-2 rounded-xl border border-navy-200 bg-white">
            <option value="32" selected>32 - Kerala (Intra-state)</option>
            <option value="33">33 - Tamil Nadu (Inter-state)</option>
            <option value="29">29 - Karnataka (Inter-state)</option>
          </select>
        </div>

        <div>
          <label class="block font-bold text-navy-700 mb-1">Document Date</label>
          <input type="date" id="doc-date" value="${new Date().toISOString().split('T')[0]}" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
      </div>

      <!-- Add Item Toolbar (Barcode Scanner, Search, Scan List) -->
      <div class="bg-white rounded-2xl border border-surface-border p-4 shadow-card flex flex-col sm:flex-row gap-3">
        <div class="flex-grow flex gap-2">
          <input type="text" id="item-search-input" placeholder="Search product by name, spec, or scan barcode with USB scanner..." class="flex-grow text-xs px-3.5 py-2.5 rounded-xl border border-navy-200 focus:outline-none focus:border-amber">
          <button id="btn-open-scan-dialog" class="bg-amber hover:bg-amber-light text-navy px-3.5 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5 whitespace-nowrap">
            <span>📷</span> Scan List
          </button>
        </div>
        <button id="btn-add-freetext" class="bg-navy-100 hover:bg-navy-200 text-navy px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap">
          + Custom Item
        </button>
      </div>

      <!-- Items Table -->
      <div class="bg-white rounded-2xl border border-surface-border shadow-card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs" id="editor-items-table">
            <thead class="bg-navy-50 text-navy-700 uppercase font-bold text-[10px] tracking-wider border-b border-navy-200">
              <tr>
                <th class="py-3 px-3 w-10">#</th>
                <th class="py-3 px-4">Item Description</th>
                <th class="py-3 px-3 w-20">HSN</th>
                <th class="py-3 px-3 w-24 text-right">Qty</th>
                <th class="py-3 px-3 w-16">Unit</th>
                <th class="py-3 px-3 w-28 text-right">Rate (₹)</th>
                <th class="py-3 px-3 w-24 text-right">Disc (₹)</th>
                <th class="py-3 px-3 w-16 text-center">GST %</th>
                <th class="py-3 px-3 w-28 text-right">Total (₹)</th>
                <th class="py-3 px-2 w-10 text-center"></th>
              </tr>
            </thead>
            <tbody id="editor-items-tbody" class="divide-y divide-navy-100">
              <!-- Rendered items -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- Totals & Notes -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div class="lg:col-span-7 bg-white rounded-2xl border border-surface-border p-5 shadow-card space-y-4">
          <div>
            <label class="block text-xs font-bold text-navy-700 mb-1">Notes / Terms</label>
            <textarea id="doc-notes" rows="2" placeholder="e.g. Delivery terms or payment instructions..." class="w-full text-xs px-3 py-2 rounded-xl border border-navy-200"></textarea>
          </div>
        </div>

        <div class="lg:col-span-5 bg-white rounded-2xl border border-surface-border p-5 shadow-card space-y-3 text-xs">
          <div class="flex justify-between text-navy-600">
            <span>Taxable Amount:</span>
            <span class="font-bold" id="lbl-taxable">₹0.00</span>
          </div>
          <div class="flex justify-between text-navy-600">
            <span>GST Total:</span>
            <span class="font-bold" id="lbl-tax">₹0.00</span>
          </div>
          <div class="flex items-center justify-between text-navy-600">
            <span>Extra Shipping / Loading:</span>
            <input type="number" id="f-extra-charges" step="1" value="0" class="w-24 text-right px-2 py-1 rounded border border-navy-200">
          </div>
          <div class="flex justify-between text-navy-600">
            <span>Round Off:</span>
            <span class="font-bold" id="lbl-roundoff">₹0.00</span>
          </div>
          <div class="flex justify-between text-lg font-black text-navy pt-3 border-t border-navy-200">
            <span>Grand Total:</span>
            <span id="lbl-grand-total">₹0.00</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#editor-items-tbody');

  function renderRows() {
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="py-8 text-center text-xs text-navy-400">No items added. Use the search bar, scan a barcode, or click "Scan List".</td></tr>';
      recalcTotals();
      return;
    }

    tbody.innerHTML = items.map((item, idx) => `
      <tr class="hover:bg-navy-50/50">
        <td class="py-2.5 px-3 text-navy-400">${idx + 1}</td>
        <td class="py-2.5 px-4">
          <input type="text" class="row-desc w-full px-2 py-1 rounded border border-navy-200 font-bold text-navy" value="${item.description}">
          ${item.currentStock !== undefined ? `<span class="text-[10px] text-navy-500">Available Stock: ${item.currentStock}</span>` : ''}
        </td>
        <td class="py-2.5 px-3">
          <input type="text" class="row-hsn w-full px-2 py-1 rounded border border-navy-200 font-mono" value="${item.hsn || ''}">
        </td>
        <td class="py-2.5 px-3">
          <input type="number" step="any" min="0.001" class="row-qty w-full text-right px-2 py-1 rounded border border-navy-200" value="${item.qty}">
        </td>
        <td class="py-2.5 px-3">
          <input type="text" class="row-unit w-full px-1 py-1 rounded border border-navy-200" value="${item.unit}">
        </td>
        <td class="py-2.5 px-3">
          <input type="number" step="0.01" class="row-rate w-full text-right px-2 py-1 rounded border border-navy-200" value="${(item.rate / 100).toFixed(2)}">
        </td>
        <td class="py-2.5 px-3">
          <input type="number" step="0.01" class="row-disc w-full text-right px-2 py-1 rounded border border-navy-200" value="${(item.discountAmount / 100).toFixed(2)}">
        </td>
        <td class="py-2.5 px-3">
          <input type="number" step="0.5" class="row-gst w-full text-center px-1 py-1 rounded border border-navy-200" value="${item.gstRate}">
        </td>
        <td class="py-2.5 px-3 text-right font-bold text-navy row-total">
          ${formatMoney(item.lineTotal)}
        </td>
        <td class="py-2.5 px-2 text-center">
          <button class="btn-remove-row text-navy-400 hover:text-rose-600 font-bold" data-idx="${idx}">✕</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.row-qty').forEach((input, i) => {
      input.addEventListener('input', () => { items[i].qty = parseFloat(input.value) || 0; updateLine(i); });
    });
    tbody.querySelectorAll('.row-rate').forEach((input, i) => {
      input.addEventListener('input', () => { items[i].rate = Math.round((parseFloat(input.value) || 0) * 100); updateLine(i); });
    });
    tbody.querySelectorAll('.row-disc').forEach((input, i) => {
      input.addEventListener('input', () => { items[i].discountAmount = Math.round((parseFloat(input.value) || 0) * 100); updateLine(i); });
    });
    tbody.querySelectorAll('.row-gst').forEach((input, i) => {
      input.addEventListener('input', () => { items[i].gstRate = parseFloat(input.value) || 0; updateLine(i); });
    });
    tbody.querySelectorAll('.row-desc').forEach((input, i) => {
      input.addEventListener('input', () => { items[i].description = input.value; });
    });
    tbody.querySelectorAll('.btn-remove-row').forEach(btn => {
      btn.addEventListener('click', () => {
        items.splice(parseInt(btn.dataset.idx, 10), 1);
        renderRows();
      });
    });

    recalcTotals();
  }

  function updateLine(i) {
    const itm = items[i];
    const gross = Math.round(itm.qty * itm.rate);
    const taxable = Math.max(0, gross - itm.discountAmount);
    const tax = Math.round((taxable * itm.gstRate) / 100);
    itm.lineTotal = taxable + tax;
    recalcTotals();
  }

  function recalcTotals() {
    let taxable = 0;
    let tax = 0;
    for (const itm of items) {
      const gross = Math.round(itm.qty * itm.rate);
      const lineTaxable = Math.max(0, gross - itm.discountAmount);
      taxable += lineTaxable;
      tax += Math.round((lineTaxable * itm.gstRate) / 100);
    }

    const extraCharges = Math.round((parseFloat(container.querySelector('#f-extra-charges')?.value) || 0) * 100);
    const preRound = taxable + tax + extraCharges;
    const grand = Math.round(preRound / 100) * 100;
    const roundOff = grand - preRound;

    container.querySelector('#lbl-taxable').textContent = formatMoney(taxable);
    container.querySelector('#lbl-tax').textContent = formatMoney(tax);
    container.querySelector('#lbl-roundoff').textContent = formatMoney(roundOff);
    container.querySelector('#lbl-grand-total').textContent = formatMoney(grand);
  }

  container.querySelector('#f-extra-charges').addEventListener('input', recalcTotals);

  // Search Products to Add
  const searchInput = container.querySelector('#item-search-input');
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (!query) return;

      const prods = await api.get(`/api/products?search=${encodeURIComponent(query)}&limit=1`);
      if (prods.items && prods.items.length > 0) {
        const p = prods.items[0];
        items.push({
          productId: p.id,
          description: `${p.name} ${p.spec || ''}`.trim(),
          hsn: p.hsn || '',
          qty: 1,
          unit: p.unit,
          rate: p.selling_price,
          discountAmount: 0,
          gstRate: p.gst_rate,
          lineTotal: p.selling_price,
          currentStock: p.current_stock
        });
        searchInput.value = '';
        renderRows();
      } else {
        showToast(`No product found matching "${query}"`, 'warning');
      }
    }
  });

  // Custom Item
  container.querySelector('#btn-add-freetext').addEventListener('click', () => {
    items.push({
      productId: null,
      description: 'Custom Electrical Item',
      hsn: '',
      qty: 1,
      unit: 'Nos',
      rate: 0,
      discountAmount: 0,
      gstRate: 18,
      lineTotal: 0
    });
    renderRows();
  });

  // Save Handlers
  async function saveDocument(shouldFinalize = false) {
    if (items.length === 0) {
      showToast('Add at least one item before saving', 'error');
      return;
    }

    const payload = {
      docType,
      customerId: selectedCustomer ? selectedCustomer.id : null,
      docDate: container.querySelector('#doc-date').value,
      placeOfSupply: container.querySelector('#doc-pos').value,
      extraCharges: Math.round((parseFloat(container.querySelector('#f-extra-charges').value) || 0) * 100),
      notes: container.querySelector('#doc-notes').value.trim() || null,
      lines: items.map(l => ({
        productId: l.productId || null,
        description: l.description,
        hsn: l.hsn || null,
        qty: l.qty,
        unit: l.unit,
        rate: l.rate,
        discountType: 'amount',
        discountValue: l.discountAmount,
        gstRate: l.gstRate
      }))
    };

    try {
      const saved = await api.post('/api/documents', payload);
      hasUnsavedChanges = false;

      if (shouldFinalize) {
        const fin = await api.post(`/api/documents/${saved.id}/finalize`);
        showToast(`Finalized as ${fin.doc_number}!`, 'success');
        setRoute('documents', { mode: 'view', docId: fin.id });
      } else {
        showToast('Draft saved successfully', 'success');
        setRoute('documents', { mode: 'view', docId: saved.id });
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  container.querySelector('#btn-save-draft').addEventListener('click', () => saveDocument(false));
  container.querySelector('#btn-save-finalize').addEventListener('click', () => saveDocument(true));
  container.querySelector('#btn-editor-back').addEventListener('click', () => {
    hasUnsavedChanges = false;
    setRoute('documents');
  });

  renderRows();
}

function openPaymentModal(doc, onSuccess) {
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  const balance = doc.grand_total - doc.paid_amount;

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-border text-xs">
      <h3 class="text-base font-bold text-navy mb-1">Record Payment</h3>
      <p class="text-navy-500 mb-4">Total Due: <span class="font-bold text-navy">${formatMoney(balance)}</span></p>

      <form id="payment-form" class="space-y-4">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Amount (₹) *</label>
          <input type="number" step="0.01" id="f-pay-amount" required value="${(balance / 100).toFixed(2)}" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-bold">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Payment Mode *</label>
          <select id="f-pay-mode" class="w-full px-3 py-2 rounded-xl border border-navy-200 bg-white">
            <option value="cash">Cash</option>
            <option value="upi">UPI / GPay / PhonePe</option>
            <option value="card">Debit / Credit Card</option>
            <option value="bank_transfer">Bank Transfer (NEFT/RTGS)</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Reference / Transaction ID</label>
          <input type="text" id="f-pay-ref" placeholder="e.g. UPI Ref / Cheque No" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="btn-pay-cancel" class="px-3 py-2 border border-navy-200 rounded-xl font-semibold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-navy text-white font-bold rounded-xl">Save Payment</button>
        </div>
      </form>
    </div>
  `;

  modal.querySelector('#btn-pay-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  modal.querySelector('#payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rupees = parseFloat(modal.querySelector('#f-pay-amount').value) || 0;
    const mode = modal.querySelector('#f-pay-mode').value;
    const ref = modal.querySelector('#f-pay-ref').value.trim();

    try {
      await api.post(`/api/documents/${doc.id}/payments`, {
        amount: Math.round(rupees * 100),
        paymentMode: mode,
        reference: ref || null
      });
      showToast('Payment recorded successfully', 'success');
      modal.classList.add('hidden');
      onSuccess();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

export default {
  renderDocuments
};
