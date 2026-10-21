import api from './api.js';
import { formatMoney, formatDate, showToast } from './ui.js';
import { getState } from './state.js';

export async function renderReports(container, params = {}) {
  const isOwner = getState().currentUser?.role === 'owner';
  let activeTab = params.tab || 'sales';

  const todayStr = new Date().toISOString().split('T')[0];
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Business Reports & Ledger</h2>
          <p class="text-xs text-navy-500 font-medium">GST filings, sales register, inventory valuation, and receivables ageing</p>
        </div>
      </div>

      <!-- Report Tabs -->
      <div class="flex flex-wrap gap-2 border-b border-navy-200 pb-2">
        <button class="rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all" data-tab="sales">Sales Register</button>
        <button class="rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all" data-tab="purchases">Purchase Register</button>
        <button class="rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all" data-tab="gst">GST Summary</button>
        <button class="rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all" data-tab="outstanding">Outstanding Dues</button>
        <button class="rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all" data-tab="stock">Stock Valuation</button>
        <button class="rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all" data-tab="low-stock">Low Stock Alerts</button>
        ${isOwner ? '<button class="rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-amber-dark" data-tab="profit">Profit & Margin</button>' : ''}
        <button class="rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold transition-all" data-tab="expenses">Expenses</button>
      </div>

      <!-- Date Filter Bar (Hidden for snapshot stock reports) -->
      <div id="rep-date-bar" class="bg-white p-3.5 rounded-2xl border border-surface-border shadow-card flex flex-wrap items-center gap-3 text-xs">
        <div class="flex items-center gap-2">
          <label class="font-bold text-navy-700">From:</label>
          <input type="date" id="rep-start-date" value="${monthStartStr}" class="px-2.5 py-1.5 rounded-lg border border-navy-200">
        </div>
        <div class="flex items-center gap-2">
          <label class="font-bold text-navy-700">To:</label>
          <input type="date" id="rep-end-date" value="${todayStr}" class="px-2.5 py-1.5 rounded-lg border border-navy-200">
        </div>
        <button id="btn-rep-refresh" class="bg-navy text-white px-3.5 py-1.5 rounded-lg font-bold shadow-card">Filter</button>
      </div>

      <!-- Report Content Display -->
      <div id="rep-content-wrapper" class="bg-white rounded-2xl border border-surface-border p-6 shadow-card overflow-hidden">
        <div class="text-center py-8 text-xs text-navy-400">Loading report data...</div>
      </div>
    </div>
  `;

  const tabs = container.querySelectorAll('.rep-tab-btn');
  const dateBar = container.querySelector('#rep-date-bar');
  const wrapper = container.querySelector('#rep-content-wrapper');

  function updateActiveTabButtons() {
    tabs.forEach(t => {
      if (t.dataset.tab === activeTab) {
        t.className = 'rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-navy text-white shadow-card';
      } else {
        t.className = 'rep-tab-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-navy-700 border border-navy-200 hover:bg-navy-50';
      }
    });

    // Hide date picker on instantaneous snapshot reports
    if (['stock', 'low-stock', 'outstanding'].includes(activeTab)) {
      dateBar.classList.add('hidden');
    } else {
      dateBar.classList.remove('hidden');
    }
  }

  async function loadActiveReport() {
    updateActiveTabButtons();
    wrapper.innerHTML = '<div class="text-center py-8 text-xs text-navy-400">Loading report data...</div>';

    const start = container.querySelector('#rep-start-date').value;
    const end = container.querySelector('#rep-end-date').value;

    try {
      if (activeTab === 'sales') {
        const data = await api.get(`/api/reports/sales?startDate=${start}&endDate=${end}`);
        renderSalesRegister(wrapper, data);
      } else if (activeTab === 'purchases') {
        const data = await api.get(`/api/reports/purchases?startDate=${start}&endDate=${end}`);
        renderPurchaseRegister(wrapper, data);
      } else if (activeTab === 'gst') {
        const data = await api.get(`/api/reports/gst-summary?startDate=${start}&endDate=${end}`);
        renderGstSummary(wrapper, data);
      } else if (activeTab === 'outstanding') {
        const data = await api.get('/api/reports/outstanding');
        renderOutstandingReport(wrapper, data);
      } else if (activeTab === 'stock') {
        const data = await api.get('/api/reports/stock');
        renderStockReport(wrapper, data);
      } else if (activeTab === 'low-stock') {
        const data = await api.get('/api/reports/low-stock');
        renderLowStockReport(wrapper, data);
      } else if (activeTab === 'profit' && isOwner) {
        const data = await api.get(`/api/reports/profit?startDate=${start}&endDate=${end}`);
        renderProfitReport(wrapper, data);
      } else if (activeTab === 'expenses') {
        const data = await api.get(`/api/reports/expenses?startDate=${start}&endDate=${end}`);
        renderExpensesReport(wrapper, data);
      }
    } catch (err) {
      wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Failed to load report: ${err.message}</div>`;
    }
  }

  tabs.forEach(t => {
    t.addEventListener('click', () => {
      activeTab = t.dataset.tab;
      loadActiveReport();
    });
  });

  container.querySelector('#btn-rep-refresh').addEventListener('click', loadActiveReport);

  loadActiveReport();
}

function renderSalesRegister(wrapper, data) {
  wrapper.innerHTML = `
    <div class="space-y-4">
      <div class="flex justify-between items-center pb-3 border-b border-navy-100">
        <div>
          <h3 class="font-bold text-sm text-navy uppercase">Sales Register</h3>
          <span class="text-xs text-navy-500">${formatDate(data.startDate)} to ${formatDate(data.endDate)}</span>
        </div>
        <div class="text-right">
          <span class="text-xs font-bold text-navy-500 uppercase block">Total Sales</span>
          <span class="text-lg font-black text-navy">${formatMoney(data.totals?.total_grand || 0)}</span>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-navy-50 font-bold text-navy-700 uppercase text-[10px] border-b border-navy-200">
            <tr>
              <th class="py-2.5 px-3">Date</th>
              <th class="py-2.5 px-3">Invoice #</th>
              <th class="py-2.5 px-3">Customer</th>
              <th class="py-2.5 px-3 text-right">Taxable</th>
              <th class="py-2.5 px-3 text-right">CGST</th>
              <th class="py-2.5 px-3 text-right">SGST</th>
              <th class="py-2.5 px-3 text-right">IGST</th>
              <th class="py-2.5 px-3 text-right">Grand Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-navy-100">
            ${(data.invoices || []).map(inv => `
              <tr>
                <td class="py-2 px-3 text-navy-600">${formatDate(inv.doc_date)}</td>
                <td class="py-2 px-3 font-bold text-navy">${inv.doc_number || '(Draft)'}</td>
                <td class="py-2 px-3">${inv.customer_name || 'Walk-in'}</td>
                <td class="py-2 px-3 text-right">${formatMoney(inv.taxable_amount)}</td>
                <td class="py-2 px-3 text-right text-navy-500">${formatMoney(inv.cgst_amount)}</td>
                <td class="py-2 px-3 text-right text-navy-500">${formatMoney(inv.sgst_amount)}</td>
                <td class="py-2 px-3 text-right text-navy-500">${formatMoney(inv.igst_amount)}</td>
                <td class="py-2 px-3 text-right font-black text-navy">${formatMoney(inv.grand_total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPurchaseRegister(wrapper, data) {
  wrapper.innerHTML = `
    <div class="space-y-4">
      <div class="flex justify-between items-center pb-3 border-b border-navy-100">
        <div>
          <h3 class="font-bold text-sm text-navy uppercase">Inward Purchase Register</h3>
          <span class="text-xs text-navy-500">${formatDate(data.startDate)} to ${formatDate(data.endDate)}</span>
        </div>
        <div class="text-right">
          <span class="text-xs font-bold text-navy-500 uppercase block">Total Purchases</span>
          <span class="text-lg font-black text-navy">${formatMoney(data.totals?.total_grand || 0)}</span>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-navy-50 font-bold text-navy-700 uppercase text-[10px] border-b border-navy-200">
            <tr>
              <th class="py-2.5 px-3">Date</th>
              <th class="py-2.5 px-3">PO #</th>
              <th class="py-2.5 px-3">Supplier</th>
              <th class="py-2.5 px-3 text-right">Taxable</th>
              <th class="py-2.5 px-3 text-right">Taxes</th>
              <th class="py-2.5 px-3 text-right">Total (₹)</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-navy-100">
            ${(data.purchases || []).map(p => `
              <tr>
                <td class="py-2 px-3 text-navy-600">${formatDate(p.doc_date)}</td>
                <td class="py-2 px-3 font-bold text-navy">${p.doc_number || '-'}</td>
                <td class="py-2 px-3">${p.supplier_name || 'Wholesaler'}</td>
                <td class="py-2 px-3 text-right">${formatMoney(p.taxable_amount)}</td>
                <td class="py-2 px-3 text-right text-navy-500">${formatMoney(parseInt(p.cgst_amount, 10) + parseInt(p.sgst_amount, 10) + parseInt(p.igst_amount, 10))}</td>
                <td class="py-2 px-3 text-right font-black text-navy">${formatMoney(p.grand_total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderGstSummary(wrapper, data) {
  wrapper.innerHTML = `
    <div class="space-y-4">
      <div class="pb-3 border-b border-navy-100">
        <h3 class="font-bold text-sm text-navy uppercase">GST Summary by Tax Slab</h3>
        <span class="text-xs text-navy-500">Breakdown of taxable turnover and liability for GSTR preparation</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-navy-50 font-bold text-navy-700 uppercase text-[10px] border-b border-navy-200">
            <tr>
              <th class="py-2.5 px-3">GST Rate</th>
              <th class="py-2.5 px-3 text-right">Taxable Value</th>
              <th class="py-2.5 px-3 text-right">CGST</th>
              <th class="py-2.5 px-3 text-right">SGST</th>
              <th class="py-2.5 px-3 text-right">IGST</th>
              <th class="py-2.5 px-3 text-right">Total Tax Liability</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-navy-100">
            ${(data.rateBreakdown || []).map(r => `
              <tr>
                <td class="py-2.5 px-3 font-bold">${r.gst_rate}% Slab</td>
                <td class="py-2.5 px-3 text-right font-medium">${formatMoney(r.total_taxable)}</td>
                <td class="py-2.5 px-3 text-right text-navy-500">${formatMoney(r.total_cgst)}</td>
                <td class="py-2.5 px-3 text-right text-navy-500">${formatMoney(r.total_sgst)}</td>
                <td class="py-2.5 px-3 text-right text-navy-500">${formatMoney(r.total_igst)}</td>
                <td class="py-2.5 px-3 text-right font-black text-navy">${formatMoney(r.total_tax)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderOutstandingReport(wrapper, data) {
  wrapper.innerHTML = `
    <div class="space-y-6">
      <div class="flex justify-between items-center pb-3 border-b border-navy-100">
        <div>
          <h3 class="font-bold text-sm text-navy uppercase">Outstanding Receivables & Ageing</h3>
          <span class="text-xs text-navy-500">Customer balances grouped into standard ageing buckets</span>
        </div>
        <div class="text-right">
          <span class="text-xs font-bold text-navy-500 uppercase block">Total Due</span>
          <span class="text-xl font-black text-rose-600">${formatMoney(data.totalOutstanding || 0)}</span>
        </div>
      </div>

      <!-- Ageing Summary Cards -->
      <div class="grid grid-cols-3 gap-4 text-center">
        <div class="bg-navy-50 p-4 rounded-xl border border-navy-200">
          <span class="text-[10px] font-bold uppercase text-navy-500 block mb-1">0 - 30 Days</span>
          <span class="text-lg font-black text-navy">${formatMoney(data.ageing?.bucket0_30 || 0)}</span>
        </div>
        <div class="bg-amber-light/30 p-4 rounded-xl border border-amber/30">
          <span class="text-[10px] font-bold uppercase text-amber-dark block mb-1">31 - 60 Days</span>
          <span class="text-lg font-black text-navy">${formatMoney(data.ageing?.bucket31_60 || 0)}</span>
        </div>
        <div class="bg-rose-50 p-4 rounded-xl border border-rose-200">
          <span class="text-[10px] font-bold uppercase text-rose-600 block mb-1">60+ Days Overdue</span>
          <span class="text-lg font-black text-rose-700">${formatMoney(data.ageing?.bucket60Plus || 0)}</span>
        </div>
      </div>

      <!-- Invoices -->
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-navy-50 font-bold text-navy-700 uppercase text-[10px] border-b border-navy-200">
            <tr>
              <th class="py-2.5 px-3">Invoice #</th>
              <th class="py-2.5 px-3">Customer</th>
              <th class="py-2.5 px-3">Date</th>
              <th class="py-2.5 px-3 text-right">Age (Days)</th>
              <th class="py-2.5 px-3 text-right">Grand Total</th>
              <th class="py-2.5 px-3 text-right">Paid</th>
              <th class="py-2.5 px-3 text-right">Balance Due</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-navy-100">
            ${(data.invoices || []).map(inv => `
              <tr>
                <td class="py-2 px-3 font-bold text-navy">${inv.docNumber}</td>
                <td class="py-2 px-3 font-medium">${inv.customerName}</td>
                <td class="py-2 px-3 text-navy-500">${formatDate(inv.docDate)}</td>
                <td class="py-2 px-3 text-right font-bold ${inv.daysOutstanding > 60 ? 'text-rose-600' : 'text-navy-600'}">${inv.daysOutstanding} d</td>
                <td class="py-2 px-3 text-right text-navy-500">${formatMoney(inv.grandTotal)}</td>
                <td class="py-2 px-3 text-right text-navy-500">${formatMoney(inv.paidAmount)}</td>
                <td class="py-2 px-3 text-right font-black text-rose-600">${formatMoney(inv.balanceDue)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderStockReport(wrapper, data) {
  wrapper.innerHTML = `
    <div class="space-y-4">
      <div class="flex justify-between items-center pb-3 border-b border-navy-100">
        <div>
          <h3 class="font-bold text-sm text-navy uppercase">Inventory Stock Valuation</h3>
          <span class="text-xs text-navy-500">${data.summary?.totalProducts || 0} unique items in catalog</span>
        </div>
        <div class="text-right">
          <span class="text-xs font-bold text-navy-500 uppercase block">Retail Valuation</span>
          <span class="text-xl font-black text-navy">${formatMoney(data.summary?.totalStockValueSelling || 0)}</span>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-navy-50 font-bold text-navy-700 uppercase text-[10px] border-b border-navy-200">
            <tr>
              <th class="py-2.5 px-3">Item Description</th>
              <th class="py-2.5 px-3">SKU</th>
              <th class="py-2.5 px-3">Category</th>
              <th class="py-2.5 px-3 text-right">In Stock</th>
              <th class="py-2.5 px-3 text-right">Selling Price</th>
              <th class="py-2.5 px-3 text-right">Total Valuation</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-navy-100">
            ${(data.products || []).map(p => `
              <tr>
                <td class="py-2 px-3 font-bold text-navy">${p.name} ${p.spec || ''}</td>
                <td class="py-2 px-3 font-mono text-[11px] text-navy-500">${p.sku}</td>
                <td class="py-2 px-3 text-navy-600">${p.category}</td>
                <td class="py-2 px-3 text-right font-semibold">${p.current_stock} ${p.unit}</td>
                <td class="py-2 px-3 text-right">${formatMoney(p.selling_price)}</td>
                <td class="py-2 px-3 text-right font-black text-navy">${formatMoney(Math.round(p.current_stock * p.selling_price))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderLowStockReport(wrapper, data) {
  wrapper.innerHTML = `
    <div class="space-y-4">
      <div class="pb-3 border-b border-navy-100">
        <h3 class="font-bold text-sm text-navy uppercase">Low Stock Reorder List</h3>
        <span class="text-xs text-navy-500">${data.count || 0} item(s) currently at or below minimum reorder threshold</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-navy-50 font-bold text-navy-700 uppercase text-[10px] border-b border-navy-200">
            <tr>
              <th class="py-2.5 px-3">Item Name</th>
              <th class="py-2.5 px-3">SKU</th>
              <th class="py-2.5 px-3">Rack</th>
              <th class="py-2.5 px-3 text-right">Current Stock</th>
              <th class="py-2.5 px-3 text-right">Min Threshold</th>
              <th class="py-2.5 px-3 text-right">Shortfall</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-navy-100">
            ${(data.items || []).map(p => `
              <tr class="bg-rose-50/30">
                <td class="py-2.5 px-3 font-bold text-navy">${p.name} ${p.spec || ''}</td>
                <td class="py-2.5 px-3 font-mono text-[11px] text-navy-500">${p.sku}</td>
                <td class="py-2.5 px-3 text-navy-600">${p.rack_location || '-'}</td>
                <td class="py-2.5 px-3 text-right font-black text-rose-700">${p.current_stock} ${p.unit}</td>
                <td class="py-2.5 px-3 text-right text-navy-600">${p.min_stock} ${p.unit}</td>
                <td class="py-2.5 px-3 text-right font-bold text-rose-600">-${(p.min_stock - p.current_stock).toFixed(1)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderProfitReport(wrapper, data) {
  wrapper.innerHTML = `
    <div class="space-y-6">
      <div class="flex justify-between items-center pb-3 border-b border-navy-100">
        <div>
          <h3 class="font-bold text-sm text-navy uppercase">Estimated Gross Profit & Margin</h3>
          <span class="text-xs text-navy-500">${formatDate(data.startDate)} to ${formatDate(data.endDate)}</span>
        </div>
        <div class="text-right">
          <span class="text-xs font-bold text-navy-500 uppercase block">Estimated Gross Profit</span>
          <span class="text-xl font-black text-emerald-dark">${formatMoney(data.totalProfit || 0)} (${data.marginPercent}%)</span>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-navy-50 font-bold text-navy-700 uppercase text-[10px] border-b border-navy-200">
            <tr>
              <th class="py-2.5 px-3">Item</th>
              <th class="py-2.5 px-3 text-right">Qty</th>
              <th class="py-2.5 px-3 text-right">Revenue (Taxable)</th>
              <th class="py-2.5 px-3 text-right">Cost</th>
              <th class="py-2.5 px-3 text-right">Profit (₹)</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-navy-100">
            ${(data.items || []).map(itm => `
              <tr>
                <td class="py-2 px-3 font-bold text-navy">${itm.description}</td>
                <td class="py-2 px-3 text-right">${itm.qty}</td>
                <td class="py-2 px-3 text-right text-navy-600">${formatMoney(itm.taxable_amount)}</td>
                <td class="py-2 px-3 text-right text-navy-500">${formatMoney(Math.round(itm.qty * itm.purchase_price))}</td>
                <td class="py-2 px-3 text-right font-black ${itm.gross_profit >= 0 ? 'text-emerald-dark' : 'text-rose-600'}">${formatMoney(itm.gross_profit)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderExpensesReport(wrapper, data) {
  wrapper.innerHTML = `
    <div class="space-y-4">
      <div class="flex justify-between items-center pb-3 border-b border-navy-100">
        <div>
          <h3 class="font-bold text-sm text-navy uppercase">Expense Summary by Category</h3>
          <span class="text-xs text-navy-500">${formatDate(data.startDate)} to ${formatDate(data.endDate)}</span>
        </div>
        <div class="text-right">
          <span class="text-xs font-bold text-navy-500 uppercase block">Total Expenses</span>
          <span class="text-xl font-black text-navy">${formatMoney(data.grandTotal || 0)}</span>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-navy-50 font-bold text-navy-700 uppercase text-[10px] border-b border-navy-200">
            <tr>
              <th class="py-2.5 px-3">Category</th>
              <th class="py-2.5 px-3 text-right">Number of Entries</th>
              <th class="py-2.5 px-3 text-right">Total Expenditure</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-navy-100">
            ${(data.byCategory || []).map(cat => `
              <tr>
                <td class="py-2.5 px-3 font-bold text-navy">${cat.category}</td>
                <td class="py-2.5 px-3 text-right text-navy-500">${cat.count}</td>
                <td class="py-2.5 px-3 text-right font-black text-navy">${formatMoney(cat.total_amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export default {
  renderReports
};
