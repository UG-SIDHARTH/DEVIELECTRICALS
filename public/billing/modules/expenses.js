import api from './api.js';
import { formatMoney, formatDate, showToast, confirmDialog } from './ui.js';
import { getState } from './state.js';

export async function renderExpenses(container) {
  const isOwner = getState().currentUser?.role === 'owner';

  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Shop Expenses & Overheads</h2>
          <p class="text-xs text-navy-500 font-medium">Record utility bills, shop logistics, delivery charges, and maintenance</p>
        </div>
        <button id="btn-add-expense" class="bg-navy hover:bg-navy-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5">
          <span>+</span> Record Expense
        </button>
      </div>

      <div class="bg-white p-4 rounded-2xl border border-surface-border shadow-card flex flex-col sm:flex-row gap-3">
        <div class="flex-grow">
          <select id="exp-category-filter" class="w-full text-xs px-3 py-2.5 rounded-xl border border-navy-200 bg-white">
            <option value="all">All Expense Categories</option>
            <option value="Rent & Utilities">Rent & Utilities</option>
            <option value="Electricity / KSEB">Electricity / KSEB</option>
            <option value="Freight & Transport">Freight & Transport</option>
            <option value="Tea & Refreshments">Tea & Refreshments</option>
            <option value="Shop Maintenance">Shop Maintenance</option>
            <option value="Packaging Materials">Packaging Materials</option>
            <option value="Salary & Wages">Salary & Wages</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>

      <div id="exp-table-wrapper" class="bg-white rounded-2xl border border-surface-border shadow-card overflow-hidden">
        <div class="p-8 text-center text-xs text-navy-400">Loading expenses...</div>
      </div>
    </div>
  `;

  async function loadExpenses() {
    const category = container.querySelector('#exp-category-filter').value;
    const wrapper = container.querySelector('#exp-table-wrapper');

    try {
      const data = await api.get(`/api/expenses?category=${encodeURIComponent(category)}`);
      if (!data.items || data.items.length === 0) {
        wrapper.innerHTML = `
          <div class="p-12 text-center">
            <span class="text-4xl mb-3 block">💸</span>
            <h4 class="font-bold text-navy text-sm mb-1">No expenses recorded</h4>
            <p class="text-xs text-navy-500">Track petty cash and utility bills to compute accurate monthly store profit.</p>
          </div>
        `;
        return;
      }

      let html = `
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy-50 text-navy-700 uppercase font-bold text-[10px] tracking-wider border-b border-navy-200">
              <tr>
                <th class="py-3 px-4">Date</th>
                <th class="py-3 px-4">Category</th>
                <th class="py-3 px-4">Description</th>
                <th class="py-3 px-4">Mode</th>
                <th class="py-3 px-4 text-right">Amount (₹)</th>
                ${isOwner ? '<th class="py-3 px-4 text-center">Actions</th>' : ''}
              </tr>
            </thead>
            <tbody class="divide-y divide-navy-100">
      `;

      for (const ex of data.items) {
        html += `
          <tr class="hover:bg-navy-50/50">
            <td class="py-3 px-4 text-navy-600 font-medium">${formatDate(ex.expense_date)}</td>
            <td class="py-3 px-4 font-bold text-navy">${ex.category}</td>
            <td class="py-3 px-4 text-navy-700 max-w-sm">${ex.description}</td>
            <td class="py-3 px-4 uppercase text-[10px] font-bold text-navy-500">${ex.payment_mode}</td>
            <td class="py-3 px-4 text-right font-black text-navy">${formatMoney(ex.amount)}</td>
            ${isOwner ? `
              <td class="py-3 px-4 text-center">
                <button class="btn-del-exp text-navy-400 hover:text-rose-600 p-1" data-id="${ex.id}">🗑️</button>
              </td>
            ` : ''}
          </tr>
        `;
      }

      html += `</tbody></table></div>`;
      wrapper.innerHTML = html;

      if (isOwner) {
        wrapper.querySelectorAll('.btn-del-exp').forEach(btn => {
          btn.addEventListener('click', async () => {
            const conf = await confirmDialog({
              title: 'Delete Expense',
              message: 'Are you sure you want to delete this expense record?',
              confirmText: 'Delete',
              isDestructive: true
            });
            if (conf) {
              try {
                await api.del(`/api/expenses/${btn.dataset.id}`);
                showToast('Expense record deleted', 'success');
                loadExpenses();
              } catch (err) {
                showToast(err.message, 'error');
              }
            }
          });
        });
      }
    } catch (err) {
      wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
    }
  }

  container.querySelector('#exp-category-filter').addEventListener('change', loadExpenses);
  container.querySelector('#btn-add-expense').addEventListener('click', () => openExpenseModal(loadExpenses));

  loadExpenses();
}

function openExpenseModal(onSuccess) {
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-border text-xs">
      <h3 class="text-base font-bold text-navy mb-4">Record Shop Expense</h3>
      <form id="exp-form" class="space-y-4">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Expense Category *</label>
          <select id="ef-category" class="w-full px-3 py-2 rounded-xl border border-navy-200 bg-white">
            <option>Freight & Transport</option>
            <option>Rent & Utilities</option>
            <option>Electricity / KSEB</option>
            <option>Tea & Refreshments</option>
            <option>Shop Maintenance</option>
            <option>Packaging Materials</option>
            <option>Salary & Wages</option>
            <option>Other</option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Amount (₹) *</label>
            <input type="number" step="0.01" id="ef-amount" required placeholder="0.00" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-bold">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">Payment Mode *</label>
            <select id="ef-mode" class="w-full px-3 py-2 rounded-xl border border-navy-200 bg-white">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="card">Card</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Description *</label>
          <input type="text" id="ef-desc" required placeholder="e.g. Auto freight for PVC pipes" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="btn-ef-cancel" class="px-3 py-2 border border-navy-200 rounded-xl font-semibold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-navy text-white font-bold rounded-xl">Save Expense</button>
        </div>
      </form>
    </div>
  `;

  modal.querySelector('#btn-ef-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  modal.querySelector('#exp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rupees = parseFloat(modal.querySelector('#ef-amount').value) || 0;
    try {
      await api.post('/api/expenses', {
        category: modal.querySelector('#ef-category').value,
        amount: Math.round(rupees * 100),
        paymentMode: modal.querySelector('#ef-mode').value,
        description: modal.querySelector('#ef-desc').value.trim()
      });
      showToast('Expense recorded', 'success');
      modal.classList.add('hidden');
      onSuccess();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

export default {
  renderExpenses
};
