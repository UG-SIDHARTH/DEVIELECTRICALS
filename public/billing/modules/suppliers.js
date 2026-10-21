import api from './api.js';
import { formatMoney, formatQty, formatDate, showToast, confirmDialog } from './ui.js';
import { setRoute } from './state.js';

export async function renderSuppliers(container) {
  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Suppliers & Inward Purchases</h2>
          <p class="text-xs text-navy-500 font-medium">Distributor profiles and purchase entries that increase stock</p>
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-add-supplier" class="bg-white hover:bg-navy-50 text-navy border border-navy-200 px-3.5 py-2 rounded-xl text-xs font-bold shadow-card">
            + Add Supplier
          </button>
          <button id="btn-new-purchase" class="bg-navy hover:bg-navy-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card">
            + Purchase Entry
          </button>
        </div>
      </div>

      <!-- Suppliers Table -->
      <div id="supp-table-wrapper" class="bg-white rounded-2xl border border-surface-border shadow-card overflow-hidden">
        <div class="p-8 text-center text-xs text-navy-400">Loading suppliers...</div>
      </div>
    </div>
  `;

  async function loadSuppliers() {
    const wrapper = container.querySelector('#supp-table-wrapper');
    try {
      const data = await api.get('/api/suppliers');
      if (!data.items || data.items.length === 0) {
        wrapper.innerHTML = `
          <div class="p-12 text-center">
            <span class="text-4xl mb-3 block">🏭</span>
            <h4 class="font-bold text-navy text-sm mb-1">No suppliers added</h4>
            <p class="text-xs text-navy-500 mb-4">Add your electrical distributors and cable wholesalers.</p>
          </div>
        `;
        return;
      }

      let html = `
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy-50 text-navy-700 uppercase font-bold text-[10px] tracking-wider border-b border-navy-200">
              <tr>
                <th class="py-3 px-4">Supplier / Wholesaler</th>
                <th class="py-3 px-4">Phone</th>
                <th class="py-3 px-4">GSTIN</th>
                <th class="py-3 px-4">Address</th>
                <th class="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-navy-100">
      `;

      for (const s of data.items) {
        html += `
          <tr class="hover:bg-navy-50/50">
            <td class="py-3 px-4 font-bold text-navy">${s.name}</td>
            <td class="py-3 px-4 font-medium">${s.phone || '-'}</td>
            <td class="py-3 px-4 font-mono text-navy-600">${s.gstin || '-'}</td>
            <td class="py-3 px-4 text-navy-500 truncate max-w-xs">${s.address || '-'}</td>
            <td class="py-3 px-4 text-center">
              <button class="btn-del-supp text-navy-400 hover:text-rose-600 p-1" data-id="${s.id}">🗑️</button>
            </td>
          </tr>
        `;
      }

      html += `</tbody></table></div>`;
      wrapper.innerHTML = html;

      wrapper.querySelectorAll('.btn-del-supp').forEach(btn => {
        btn.addEventListener('click', async () => {
          const conf = await confirmDialog({
            title: 'Delete Supplier',
            message: 'Are you sure you want to delete this supplier profile?',
            confirmText: 'Delete',
            isDestructive: true
          });
          if (conf) {
            try {
              await api.del(`/api/suppliers/${btn.dataset.id}`);
              showToast('Supplier deleted', 'success');
              loadSuppliers();
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        });
      });
    } catch (err) {
      wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
    }
  }

  container.querySelector('#btn-add-supplier').addEventListener('click', () => openSupplierModal(loadSuppliers));
  container.querySelector('#btn-new-purchase').addEventListener('click', () => setRoute('documents', { mode: 'create', docType: 'purchase' }));

  loadSuppliers();
}

function openSupplierModal(onSuccess) {
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-border text-xs">
      <h3 class="text-base font-bold text-navy mb-4">Add Supplier Profile</h3>
      <form id="supp-form" class="space-y-4">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Company / Wholesaler Name *</label>
          <input type="text" id="sf-name" required placeholder="e.g. Kerala Electrical Distributors" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Phone Number</label>
          <input type="tel" id="sf-phone" placeholder="Contact number" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">GSTIN</label>
          <input type="text" id="sf-gstin" placeholder="15-digit GSTIN" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-mono">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Office / Warehouse Address</label>
          <textarea id="sf-address" rows="2" class="w-full px-3 py-2 rounded-xl border border-navy-200"></textarea>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="btn-sf-cancel" class="px-3 py-2 border border-navy-200 rounded-xl font-semibold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-navy text-white font-bold rounded-xl">Save Supplier</button>
        </div>
      </form>
    </div>
  `;

  modal.querySelector('#btn-sf-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  modal.querySelector('#supp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/suppliers', {
        name: modal.querySelector('#sf-name').value.trim(),
        phone: modal.querySelector('#sf-phone').value.trim() || null,
        gstin: modal.querySelector('#sf-gstin').value.trim().toUpperCase() || null,
        address: modal.querySelector('#sf-address').value.trim() || null,
        state_code: '32'
      });
      showToast('Supplier saved', 'success');
      modal.classList.add('hidden');
      onSuccess();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

export default {
  renderSuppliers
};
