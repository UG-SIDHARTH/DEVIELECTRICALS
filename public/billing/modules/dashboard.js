import api from './api.js';
import { formatMoney, formatDate } from './ui.js';
import { setRoute } from './state.js';

export async function renderDashboard(container) {
  container.innerHTML = `
    <div class="space-y-8">
      <!-- Header with Quick Action Buttons -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Store Dashboard</h2>
          <p class="text-xs text-navy-500 font-medium">Daily overview of sales, counter bills, and inventory health</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button id="btn-quick-invoice" class="bg-navy hover:bg-navy-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5">
            <span>+</span> New Invoice
          </button>
          <button id="btn-quick-quote" class="bg-white hover:bg-navy-50 text-navy border border-navy-200 px-4 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5">
            <span>+</span> New Quotation
          </button>
          <button id="btn-quick-scan" class="bg-amber hover:bg-amber-light text-navy px-4 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5">
            <span>📷</span> Scan List
          </button>
        </div>
      </div>

      <!-- Stat Metric Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4" id="stats-grid">
        <div class="bg-white p-5 rounded-2xl border border-surface-border shadow-card">
          <span class="text-xs font-bold text-navy-400 uppercase tracking-wider block mb-1">Today's Sales</span>
          <span class="text-2xl font-black text-navy" id="stat-today-sales">₹0.00</span>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-surface-border shadow-card">
          <span class="text-xs font-bold text-navy-400 uppercase tracking-wider block mb-1">This Month</span>
          <span class="text-2xl font-black text-navy" id="stat-month-sales">₹0.00</span>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-surface-border shadow-card">
          <span class="text-xs font-bold text-navy-400 uppercase tracking-wider block mb-1">Outstanding Dues</span>
          <span class="text-2xl font-black text-rose-600" id="stat-outstanding">₹0.00</span>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-surface-border shadow-card cursor-pointer hover:border-amber transition-colors" id="card-low-stock">
          <span class="text-xs font-bold text-navy-400 uppercase tracking-wider block mb-1">Low Stock Alerts</span>
          <span class="text-2xl font-black text-amber-dark" id="stat-low-stock">0</span>
        </div>
      </div>

      <!-- 7-Day Sales Trend (Inline SVG Chart) & Recent Documents -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <!-- Chart Column -->
        <div class="lg:col-span-7 bg-white p-6 rounded-2xl border border-surface-border shadow-card">
          <h3 class="font-bold text-sm text-navy uppercase tracking-wider mb-4">7-Day Sales Activity</h3>
          <div class="w-full overflow-hidden" id="chart-container">
            <!-- Inline SVG inserted dynamically -->
          </div>
        </div>

        <!-- Recent Documents Column -->
        <div class="lg:col-span-5 bg-white p-6 rounded-2xl border border-surface-border shadow-card">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-sm text-navy uppercase tracking-wider">Recent Documents</h3>
            <button id="btn-view-all-docs" class="text-xs font-bold text-amber-dark hover:underline">View All</button>
          </div>
          <div class="divide-y divide-navy-100 overflow-x-auto" id="recent-docs-list">
            <p class="text-xs text-navy-400 py-4 text-center">Loading recent activity...</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach button events
  container.querySelector('#btn-quick-invoice').addEventListener('click', () => setRoute('documents', { mode: 'create', docType: 'invoice' }));
  container.querySelector('#btn-quick-quote').addEventListener('click', () => setRoute('documents', { mode: 'create', docType: 'quotation' }));
  container.querySelector('#btn-quick-scan').addEventListener('click', () => setRoute('scan'));
  container.querySelector('#btn-view-all-docs').addEventListener('click', () => setRoute('documents'));
  container.querySelector('#card-low-stock').addEventListener('click', () => setRoute('reports', { tab: 'low-stock' }));

  // Load Dashboard Data
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const monthStartStr = `${todayStr.slice(0, 7)}-01`;

    const [todaySales, monthSales, outstandingRes, lowStockRes, recentDocs] = await Promise.all([
      api.get(`/api/reports/sales?startDate=${todayStr}&endDate=${todayStr}`),
      api.get(`/api/reports/sales?startDate=${monthStartStr}&endDate=${todayStr}`),
      api.get('/api/reports/outstanding'),
      api.get('/api/reports/low-stock'),
      api.get('/api/documents?limit=6')
    ]);

    container.querySelector('#stat-today-sales').textContent = formatMoney(todaySales.totals?.total_grand || 0);
    container.querySelector('#stat-month-sales').textContent = formatMoney(monthSales.totals?.total_grand || 0);
    container.querySelector('#stat-outstanding').textContent = formatMoney(outstandingRes.totalOutstanding || 0);
    container.querySelector('#stat-low-stock').textContent = lowStockRes.count || 0;

    // Render 7-day SVG Bar Chart
    renderSalesChart(container.querySelector('#chart-container'), todaySales.invoices || []);

    // Render Recent Documents
    renderRecentDocuments(container.querySelector('#recent-docs-list'), recentDocs.items || []);
  } catch (err) {
    console.error('Failed to load dashboard:', err.message);
  }
}

function renderSalesChart(container, invoices) {
  // Compute past 7 days dates in IST
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const totals = days.map(day => {
    return invoices
      .filter(inv => inv.doc_date && inv.doc_date.startsWith(day))
      .reduce((sum, inv) => sum + parseInt(inv.grand_total, 10), 0);
  });

  const max = Math.max(...totals, 50000); // minimum scale ₹500
  const svgW = 600;
  const svgH = 220;
  const barW = 44;
  const gap = (svgW - (barW * 7)) / 8;

  let barsSvg = '';
  days.forEach((day, idx) => {
    const amount = totals[idx];
    const barHeight = Math.max(4, Math.round((amount / max) * 140));
    const x = Math.round(gap + (idx * (barW + gap)));
    const y = 170 - barHeight;
    const labelDate = day.slice(5).replace('-', '/');

    barsSvg += `
      <g>
        <rect x="${x}" y="${y}" width="${barW}" height="${barHeight}" rx="6" fill="#F59E0B" />
        <text x="${x + barW / 2}" y="195" text-anchor="middle" font-size="11" font-weight="600" fill="#64748B">${labelDate}</text>
        <text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="10" font-weight="700" fill="#0F172A">₹${(amount / 100).toFixed(0)}</text>
      </g>
    `;
  });

  container.innerHTML = `
    <svg width="100%" height="220" viewBox="0 0 600 220" class="overflow-visible">
      <line x1="0" y1="170" x2="600" y2="170" stroke="#E2E8F0" stroke-width="1.5" />
      ${barsSvg}
    </svg>
  `;
}

function renderRecentDocuments(container, docs) {
  if (docs.length === 0) {
    container.innerHTML = '<p class="text-xs text-navy-400 py-4 text-center">No recent documents created.</p>';
    return;
  }

  container.innerHTML = docs.map(doc => {
    const isPaid = doc.status === 'paid';
    const statusClass = isPaid
      ? 'bg-emerald/10 text-emerald-dark'
      : (doc.status === 'cancelled' ? 'bg-rose-100 text-rose-700' : 'bg-amber-light/30 text-navy');

    return `
      <div class="py-3 flex items-center justify-between text-xs cursor-pointer hover:bg-navy-50 rounded-lg px-2" data-doc-id="${doc.id}">
        <div>
          <span class="font-bold text-navy block">${doc.doc_number || '(Draft ' + doc.doc_type + ')'}</span>
          <span class="text-navy-500">${doc.customer_name || 'Walk-in'} • ${formatDate(doc.doc_date)}</span>
        </div>
        <div class="text-right">
          <span class="font-bold text-navy block">${formatMoney(doc.grand_total)}</span>
          <span class="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${statusClass}">${doc.status}</span>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-doc-id]').forEach(el => {
    el.addEventListener('click', () => {
      setRoute('documents', { mode: 'view', docId: el.dataset.docId });
    });
  });
}

export default {
  renderDashboard
};
