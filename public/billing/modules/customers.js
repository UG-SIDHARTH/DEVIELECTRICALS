import api from './api.js';
import { formatMoney, formatDate, showToast, confirmDialog } from './ui.js';
import { setRoute } from './state.js';

export async function renderCustomers(container) {
  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Customer Directory</h2>
          <p class="text-xs text-navy-500 font-medium">Customer contact details, GSTIN records, and ledger balances</p>
        </div>
        <button id="btn-add-customer" class="bg-navy hover:bg-navy-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-card flex items-center gap-1.5">
          <span>+</span> Add Customer
        </button>
      </div>

      <!-- Search -->
      <div class="bg-white p-4 rounded-2xl border border-surface-border shadow-card">
        <input type="text" id="cust-search" placeholder="Search customer by name, exact phone, or GSTIN..." class="w-full text-xs px-3.5 py-2.5 rounded-xl border border-navy-200">
      </div>

      <!-- Customers Table -->
      <div id="cust-table-wrapper" class="bg-white rounded-2xl border border-surface-border shadow-card overflow-hidden">
        <div class="p-8 text-center text-xs text-navy-400">Loading customers...</div>
      </div>

      <div id="cust-pagination" class="flex items-center justify-between text-xs px-2 text-navy-600"></div>
    </div>
  `;

  let currentPage = 1;

  async function loadCustomers() {
    const search = container.querySelector('#cust-search').value.trim();
    const wrapper = container.querySelector('#cust-table-wrapper');
    const pagination = container.querySelector('#cust-pagination');

    try {
      const data = await api.get(`/api/customers?page=${currentPage}&limit=50&search=${encodeURIComponent(search)}`);

      if (!data.items || data.items.length === 0) {
        wrapper.innerHTML = `
          <div class="p-12 text-center">
            <span class="text-4xl mb-3 block">👥</span>
            <h4 class="font-bold text-navy text-sm mb-1">No customers registered</h4>
            <p class="text-xs text-navy-500 mb-4">Add contractor or regular client profiles to enable fast billing.</p>
            <button id="btn-empty-cust" class="bg-navy text-white text-xs font-bold px-4 py-2.5 rounded-xl">Add Customer</button>
          </div>
        `;
        wrapper.querySelector('#btn-empty-cust')?.addEventListener('click', () => openCustomerDrawer());
        pagination.innerHTML = '';
        return;
      }

      let html = `
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-navy-50 text-navy-700 uppercase font-bold text-[10px] tracking-wider border-b border-navy-200">
              <tr>
                <th class="py-3 px-4">Customer Name</th>
                <th class="py-3 px-4">Phone</th>
                <th class="py-3 px-4">GSTIN</th>
                <th class="py-3 px-4">State</th>
                <th class="py-3 px-4">Address</th>
                <th class="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-navy-100">
      `;

      for (const c of data.items) {
        html += `
          <tr class="hover:bg-navy-50/50">
            <td class="py-3 px-4 font-bold text-navy">${c.name}</td>
            <td class="py-3 px-4 font-medium text-navy-600">${c.phone || '-'}</td>
            <td class="py-3 px-4 font-mono text-[11px] text-navy-600">${c.gstin || '-'}</td>
            <td class="py-3 px-4 text-navy-600">Code ${c.state_code}</td>
            <td class="py-3 px-4 text-navy-500 max-w-xs truncate">${c.address || '-'}</td>
            <td class="py-3 px-4 text-center">
              <div class="flex items-center justify-center gap-1.5">
                ${c.phone ? `<button class="btn-wa-reminder p-1 text-emerald-dark hover:opacity-80" data-name="${c.name}" data-phone="${c.phone}" title="WhatsApp Reminder">💬</button>` : ''}
                <button class="btn-edit-cust p-1 text-navy-500 hover:text-navy" data-id="${c.id}" title="Edit">✏️</button>
                <button class="btn-del-cust p-1 text-navy-400 hover:text-rose-600" data-id="${c.id}" title="Delete">🗑️</button>
              </div>
            </td>
          </tr>
        `;
      }

      html += `</tbody></table></div>`;
      wrapper.innerHTML = html;

      wrapper.querySelectorAll('.btn-edit-cust').forEach(btn => {
        btn.addEventListener('click', () => openCustomerDrawer(btn.dataset.id));
      });
      wrapper.querySelectorAll('.btn-del-cust').forEach(btn => {
        btn.addEventListener('click', () => deleteCustomer(btn.dataset.id));
      });
      wrapper.querySelectorAll('.btn-wa-reminder').forEach(btn => {
        btn.addEventListener('click', () => {
          const phone = btn.dataset.phone.replace(/\D/g, '');
          const msg = `Dear ${btn.dataset.name},\nThis is a polite reminder regarding your outstanding bill at Devi Electrical, Kazhakkoottam. Please contact us at 094472 20411 for assistance. Thank you!`;
          window.open(`https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(msg)}`, '_blank');
        });
      });

      pagination.innerHTML = `
        <span>Page ${data.pagination.page} of ${data.pagination.totalPages}</span>
        <div class="flex gap-2">
          <button id="btn-c-prev" class="px-3 py-1 rounded bg-white border border-navy-200" ${data.pagination.page <= 1 ? 'disabled' : ''}>Previous</button>
          <button id="btn-c-next" class="px-3 py-1 rounded bg-white border border-navy-200" ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''}>Next</button>
        </div>
      `;
      pagination.querySelector('#btn-c-prev')?.addEventListener('click', () => { currentPage--; loadCustomers(); });
      pagination.querySelector('#btn-c-next')?.addEventListener('click', () => { currentPage++; loadCustomers(); });

    } catch (err) {
      wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
    }
  }

  container.querySelector('#cust-search').addEventListener('input', () => { currentPage = 1; loadCustomers(); });
  container.querySelector('#btn-add-customer').addEventListener('click', () => openCustomerDrawer());

  loadCustomers();
}

async function openCustomerDrawer(customerId = null) {
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  let cust = {
    name: '',
    phone: '',
    email: '',
    gstin: '',
    address: '',
    state_code: '32'
  };

  if (customerId) {
    try {
      cust = await api.get(`/api/customers/${customerId}`);
    } catch (err) {
      showToast(err.message, 'error');
      modal.classList.add('hidden');
      return;
    }
  }

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-surface-border text-xs">
      <div class="flex items-center justify-between pb-3 border-b border-navy-100 mb-4">
        <h3 class="text-base font-bold text-navy">${customerId ? 'Edit Customer' : 'Add Customer'}</h3>
        <button id="cust-modal-close" class="text-navy-400 hover:text-navy text-lg font-bold">✕</button>
      </div>

      <form id="cust-form" class="space-y-4">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Customer / Firm Name *</label>
          <input type="text" id="cf-name" required value="${cust.name}" placeholder="e.g. Sreejith Builders" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Phone Number</label>
            <input type="tel" id="cf-phone" value="${cust.phone || ''}" placeholder="10-digit mobile" class="w-full px-3 py-2 rounded-xl border border-navy-200">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">GSTIN (15 chars)</label>
            <input type="text" id="cf-gstin" value="${cust.gstin || ''}" placeholder="32AAAAA0000A1Z5" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-mono">
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Email Address</label>
            <input type="email" id="cf-email" value="${cust.email || ''}" placeholder="optional" class="w-full px-3 py-2 rounded-xl border border-navy-200">
          </div>
          <div>
            <label class="block font-bold text-navy-700 mb-1">State Code</label>
            <input type="text" id="cf-state" value="${cust.state_code}" class="w-full px-3 py-2 rounded-xl border border-navy-200">
          </div>
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Billing / Delivery Address</label>
          <textarea id="cf-address" rows="2" class="w-full px-3 py-2 rounded-xl border border-navy-200">${cust.address || ''}</textarea>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="btn-cust-cancel" class="px-3 py-2 border border-navy-200 rounded-xl font-semibold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-navy text-white font-bold rounded-xl">Save Customer</button>
        </div>
      </form>
    </div>
  `;

  modal.querySelector('#cust-modal-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.querySelector('#btn-cust-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  modal.querySelector('#cust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: modal.querySelector('#cf-name').value.trim(),
      phone: modal.querySelector('#cf-phone').value.trim() || null,
      email: modal.querySelector('#cf-email').value.trim() || null,
      gstin: modal.querySelector('#cf-gstin').value.trim().toUpperCase() || null,
      state_code: modal.querySelector('#cf-state').value.trim() || '32',
      address: modal.querySelector('#cf-address').value.trim() || null
    };

    try {
      if (customerId) {
        await api.put(`/api/customers/${customerId}`, payload);
        showToast('Customer updated', 'success');
      } else {
        await api.post('/api/customers', payload);
        showToast('Customer created', 'success');
      }
      modal.classList.add('hidden');
      renderCustomers(document.querySelector('#billing-content'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function deleteCustomer(id) {
  const conf = await confirmDialog({
    title: 'Delete Customer',
    message: 'Are you sure you want to delete this customer? This is only allowed if no historical bills are linked.',
    confirmText: 'Delete',
    isDestructive: true
  });

  if (conf) {
    try {
      await api.del(`/api/customers/${id}`);
      showToast('Customer deleted', 'success');
      renderCustomers(document.querySelector('#billing-content'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}

export default {
  renderCustomers
};
