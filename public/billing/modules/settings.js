import api from './api.js';
import { formatMoney, formatDate, showToast, confirmDialog } from './ui.js';
import { getState, setStoreSettings } from './state.js';

export async function renderSettings(container, params = {}) {
  const isOwner = getState().currentUser?.role === 'owner';
  if (!isOwner) {
    container.innerHTML = '<div class="p-8 text-center text-xs text-rose-600">Access Denied: Settings are restricted to the store owner.</div>';
    return;
  }

  let activeSection = params.section || 'profile';

  container.innerHTML = `
    <div class="space-y-6">
      <div>
        <h2 class="text-2xl font-black text-navy tracking-tight">System Settings & Administration</h2>
        <p class="text-xs text-navy-500 font-medium">Business profile, security, staff access, encrypted backups, and system status</p>
      </div>

      <!-- Settings Navigation Tabs -->
      <div class="flex flex-wrap gap-2 border-b border-navy-200 pb-2">
        <button class="set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold" data-sec="profile">Store Profile</button>
        <button class="set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold" data-sec="rules">Tax & Numbering</button>
        <button class="set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold" data-sec="users">Staff & Users</button>
        <button class="set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold" data-sec="2fa">Two-Factor Auth</button>
        <button class="set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold" data-sec="status">System Status</button>
        <button class="set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold" data-sec="backup">Export & Restore</button>
        <button class="set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold" data-sec="audit">Audit Log</button>
      </div>

      <div id="settings-content" class="bg-white rounded-2xl border border-surface-border p-6 shadow-card">
        <div class="text-center py-8 text-xs text-navy-400">Loading settings...</div>
      </div>
    </div>
  `;

  const navBtns = container.querySelectorAll('.set-nav-btn');
  const contentWrapper = container.querySelector('#settings-content');

  function updateNav() {
    navBtns.forEach(btn => {
      if (btn.dataset.sec === activeSection) {
        btn.className = 'set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-navy text-white shadow-card';
      } else {
        btn.className = 'set-nav-btn px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-navy-700 border border-navy-200 hover:bg-navy-50';
      }
    });
  }

  async function loadSection() {
    updateNav();
    contentWrapper.innerHTML = '<div class="text-center py-8 text-xs text-navy-400">Loading section...</div>';

    try {
      if (activeSection === 'profile') {
        const s = await api.get('/api/settings');
        setStoreSettings(s);
        renderProfileSection(contentWrapper, s);
      } else if (activeSection === 'rules') {
        const s = await api.get('/api/settings');
        renderRulesSection(contentWrapper, s);
      } else if (activeSection === 'users') {
        renderUsersSection(contentWrapper);
      } else if (activeSection === '2fa') {
        render2FaSection(contentWrapper);
      } else if (activeSection === 'status') {
        renderSystemStatusSection(contentWrapper);
      } else if (activeSection === 'backup') {
        renderBackupSection(contentWrapper);
      } else if (activeSection === 'audit') {
        renderAuditSection(contentWrapper);
      }
    } catch (err) {
      contentWrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
    }
  }

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activeSection = btn.dataset.sec;
      loadSection();
    });
  });

  loadSection();
}

function renderProfileSection(wrapper, s) {
  wrapper.innerHTML = `
    <form id="profile-form" class="space-y-4 max-w-2xl text-xs">
      <h3 class="font-bold text-sm text-navy uppercase mb-2">Business Profile & Banking</h3>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Store Name *</label>
          <input type="text" id="sf-name" required value="${s.businessName}" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Primary Phone *</label>
          <input type="text" id="sf-phone" required value="${s.phone}" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
      </div>

      <div>
        <label class="block font-bold text-navy-700 mb-1">Address *</label>
        <textarea id="sf-address" rows="2" required class="w-full px-3 py-2 rounded-xl border border-navy-200">${s.address}</textarea>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-navy-100">
        <div>
          <label class="block font-bold text-navy-700 mb-1">GSTIN (15 chars)</label>
          <input type="text" id="sf-gstin" value="${s.gstin || ''}" placeholder="32AAAAA0000A1Z5" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-mono">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">UPI ID (VPA)</label>
          <input type="text" id="sf-upi" value="${s.upiId || ''}" placeholder="username@okhdfcbank" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Store Opening Time (optional)</label>
          <input type="time" id="sf-opening-time" value="${s.openingTime || ''}" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-navy-100">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Bank Name</label>
          <input type="text" id="sf-bank-name" value="${s.bankName || ''}" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Account Number</label>
          <input type="text" id="sf-bank-ac" value="${s.bankAccount || ''}" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-mono">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">IFSC Code</label>
          <input type="text" id="sf-bank-ifsc" value="${s.bankIfsc || ''}" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-mono">
        </div>
      </div>

      <div class="pt-4 flex justify-end">
        <button type="submit" class="bg-navy hover:bg-navy-800 text-white font-bold px-5 py-2.5 rounded-xl shadow-card">
          Save Profile
        </button>
      </div>
    </form>
  `;

  wrapper.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const updated = await api.put('/api/settings', {
        ...s,
        businessName: wrapper.querySelector('#sf-name').value.trim(),
        phone: wrapper.querySelector('#sf-phone').value.trim(),
        address: wrapper.querySelector('#sf-address').value.trim(),
        gstin: wrapper.querySelector('#sf-gstin').value.trim().toUpperCase() || null,
        upiId: wrapper.querySelector('#sf-upi').value.trim() || null,
        openingTime: wrapper.querySelector('#sf-opening-time').value || null,
        bankName: wrapper.querySelector('#sf-bank-name').value.trim() || null,
        bankAccount: wrapper.querySelector('#sf-bank-ac').value.trim() || null,
        bankIfsc: wrapper.querySelector('#sf-bank-ifsc').value.trim().toUpperCase() || null
      });
      setStoreSettings(updated);
      showToast('Store profile updated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function renderRulesSection(wrapper, s) {
  wrapper.innerHTML = `
    <form id="rules-form" class="space-y-4 max-w-2xl text-xs">
      <h3 class="font-bold text-sm text-navy uppercase mb-2">Tax Settings & Document Numbering</h3>

      <div class="flex items-center gap-3 p-4 bg-navy-50 rounded-xl border border-navy-200">
        <input type="checkbox" id="rf-gst-reg" ${s.gstRegistered ? 'checked' : ''} class="w-4 h-4 rounded text-navy">
        <div>
          <label for="rf-gst-reg" class="font-bold text-navy block">Registered for GST (Regular Taxpayer)?</label>
          <span class="text-navy-500 text-[11px]">When disabled, documents are titled "Cash Bill" with no tax columns.</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Invoice Prefix *</label>
          <input type="text" id="rf-inv-pfx" required value="${s.invoicePrefix}" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-mono">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Quotation Prefix *</label>
          <input type="text" id="rf-quote-pfx" required value="${s.quotationPrefix}" class="w-full px-3 py-2 rounded-xl border border-navy-200 font-mono">
        </div>
      </div>

      <div class="flex items-center gap-3 p-4 bg-navy-50 rounded-xl border border-navy-200">
        <input type="checkbox" id="rf-neg-stock" ${s.allowNegativeStock ? 'checked' : ''} class="w-4 h-4 rounded text-navy">
        <div>
          <label for="rf-neg-stock" class="font-bold text-navy block">Allow Billing with Negative Stock?</label>
          <span class="text-navy-500 text-[11px]">If unchecked, billing an item with insufficient stock will be blocked.</span>
        </div>
      </div>

      <div class="pt-4 flex justify-end">
        <button type="submit" class="bg-navy hover:bg-navy-800 text-white font-bold px-5 py-2.5 rounded-xl shadow-card">
          Save Rules
        </button>
      </div>
    </form>
  `;

  wrapper.querySelector('#rules-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const updated = await api.put('/api/settings', {
        ...s,
        gstRegistered: wrapper.querySelector('#rf-gst-reg').checked,
        invoicePrefix: wrapper.querySelector('#rf-inv-pfx').value.trim(),
        quotationPrefix: wrapper.querySelector('#rf-quote-pfx').value.trim(),
        allowNegativeStock: wrapper.querySelector('#rf-neg-stock').checked
      });
      setStoreSettings(updated);
      showToast('Rules saved successfully', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function renderUsersSection(wrapper) {
  try {
    const data = await api.get('/api/settings/users');

    wrapper.innerHTML = `
      <div class="space-y-6 text-xs">
        <div class="flex justify-between items-center pb-3 border-b border-navy-100">
          <div>
            <h3 class="font-bold text-sm text-navy uppercase">Staff & Account Administration</h3>
            <span class="text-navy-500">Manage login credentials and access levels</span>
          </div>
          <button id="btn-add-staff" class="bg-navy text-white font-bold px-3.5 py-1.5 rounded-xl shadow-card">+ Add Staff</button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-navy-50 font-bold uppercase text-[10px] text-navy-700">
              <tr>
                <th class="py-2.5 px-3">Username</th>
                <th class="py-2.5 px-3">Role</th>
                <th class="py-2.5 px-3">2FA Active</th>
                <th class="py-2.5 px-3">Status</th>
                <th class="py-2.5 px-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-navy-100">
              ${data.users.map(u => `
                <tr>
                  <td class="py-2.5 px-3 font-bold text-navy">${u.username}</td>
                  <td class="py-2.5 px-3 uppercase text-[10px] font-bold text-navy-600">${u.role}</td>
                  <td class="py-2.5 px-3">${u.totp_enabled ? '<span class="text-emerald font-bold">Enabled</span>' : '<span class="text-navy-400">Off</span>'}</td>
                  <td class="py-2.5 px-3">${u.disabled ? '<span class="text-rose-600 font-bold">Disabled</span>' : '<span class="text-emerald-dark font-medium">Active</span>'}</td>
                  <td class="py-2.5 px-3 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                      <button class="btn-pwd-user text-navy-500 hover:text-navy px-2 py-0.5 border rounded" data-id="${u.id}" data-name="${u.username}">Reset Password</button>
                      <button class="btn-toggle-user text-navy-500 hover:text-navy px-2 py-0.5 border rounded" data-id="${u.id}">${u.disabled ? 'Enable' : 'Disable'}</button>
                      <button class="btn-logout-user text-navy-500 hover:text-rose-600 px-2 py-0.5 border rounded" data-id="${u.id}">Logout All</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    wrapper.querySelector('#btn-add-staff').addEventListener('click', () => openAddStaffModal(() => renderUsersSection(wrapper)));

    wrapper.querySelectorAll('.btn-pwd-user').forEach(btn => {
      btn.addEventListener('click', () => openResetPasswordModal(btn.dataset.id, btn.dataset.name));
    });

    wrapper.querySelectorAll('.btn-toggle-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.put(`/api/settings/users/${btn.dataset.id}/toggle-disabled`);
          showToast('User status updated', 'success');
          renderUsersSection(wrapper);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    wrapper.querySelectorAll('.btn-logout-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.post(`/api/settings/users/${btn.dataset.id}/logout-all`);
          showToast('All sessions revoked for user', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

  } catch (err) {
    wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
  }
}

function openAddStaffModal(onSuccess) {
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-border text-xs">
      <h3 class="text-base font-bold text-navy mb-4">Add Staff Member</h3>
      <form id="add-staff-form" class="space-y-4">
        <div>
          <label class="block font-bold text-navy-700 mb-1">Username *</label>
          <input type="text" id="af-user" required placeholder="letters and numbers" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Password (min 12 chars) *</label>
          <input type="password" id="af-pass" required minlength="12" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>
        <div>
          <label class="block font-bold text-navy-700 mb-1">Role</label>
          <select id="af-role" class="w-full px-3 py-2 rounded-xl border border-navy-200 bg-white">
            <option value="staff">Staff (Billing, Quotations, Products)</option>
            <option value="owner">Owner (Full Permissions & Financials)</option>
          </select>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="btn-af-cancel" class="px-3 py-2 border border-navy-200 rounded-xl font-semibold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-navy text-white font-bold rounded-xl">Create User</button>
        </div>
      </form>
    </div>
  `;

  modal.querySelector('#btn-af-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  modal.querySelector('#add-staff-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/settings/users', {
        username: modal.querySelector('#af-user').value.trim(),
        password: modal.querySelector('#af-pass').value,
        role: modal.querySelector('#af-role').value
      });
      showToast('User created successfully', 'success');
      modal.classList.add('hidden');
      onSuccess();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function openResetPasswordModal(userId, username) {
  const modal = document.getElementById('modal-container');
  modal.classList.remove('hidden');

  modal.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-border text-xs">
      <h3 class="text-base font-bold text-navy mb-2">Reset Password</h3>
      <p class="text-navy-500 mb-4">Resetting password for user: <span class="font-bold text-navy">${username}</span></p>

      <form id="reset-pwd-form" class="space-y-4">
        <div>
          <label class="block font-bold text-navy-700 mb-1">New Password (min 12 chars) *</label>
          <input type="password" id="rf-pwd" required minlength="12" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="btn-rf-cancel" class="px-3 py-2 border border-navy-200 rounded-xl font-semibold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-navy text-white font-bold rounded-xl">Update Password</button>
        </div>
      </form>
    </div>
  `;

  modal.querySelector('#btn-rf-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  modal.querySelector('#reset-pwd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.put(`/api/settings/users/${userId}/password`, {
        newPassword: modal.querySelector('#rf-pwd').value
      });
      showToast('Password updated successfully', 'success');
      modal.classList.add('hidden');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function render2FaSection(wrapper) {
  const user = getState().currentUser;

  if (user?.totpEnabled) {
    wrapper.innerHTML = `
      <div class="space-y-4 max-w-md text-xs">
        <h3 class="font-bold text-sm text-navy uppercase">Two-Factor Authentication (2FA)</h3>
        <div class="p-4 bg-emerald/10 border border-emerald/30 rounded-xl text-emerald-dark font-semibold">
          ✓ Two-Factor Authentication is currently ACTIVE on your account.
        </div>
        <button id="btn-disable-2fa" class="px-4 py-2 bg-rose-50 border border-rose-200 text-rose-700 font-bold rounded-xl">
          Disable 2FA
        </button>
      </div>
    `;

    wrapper.querySelector('#btn-disable-2fa').addEventListener('click', async () => {
      const pwd = prompt('Enter your current account password to confirm disabling 2FA:');
      if (pwd) {
        try {
          await api.post('/api/auth/2fa/disable', { password: pwd });
          showToast('2FA disabled', 'success');
          user.totpEnabled = false;
          render2FaSection(wrapper);
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
    return;
  }

  // Setup Flow
  try {
    const setupData = await api.post('/api/auth/2fa/setup');

    wrapper.innerHTML = `
      <div class="space-y-4 max-w-md text-xs">
        <h3 class="font-bold text-sm text-navy uppercase">Setup Two-Factor Authentication</h3>
        <p class="text-navy-600 leading-relaxed">
          Scan this QR code with Google Authenticator, Aegis, or any standard TOTP app.
        </p>

        <div class="p-4 bg-white border border-navy-200 rounded-2xl w-48 mx-auto flex items-center justify-center">
          ${setupData.qrSvg}
        </div>

        <p class="text-[11px] font-mono text-center text-navy-500">Secret: ${setupData.secret}</p>

        <form id="verify-2fa-form" class="space-y-3 pt-2">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Enter 6-digit code from authenticator app</label>
            <input type="text" id="totp-code-input" required maxlength="6" placeholder="000000" class="w-full text-center font-mono text-base tracking-widest px-3 py-2 rounded-xl border border-navy-200">
          </div>
          <button type="submit" class="w-full bg-navy text-white font-bold py-2.5 rounded-xl shadow-card">
            Verify and Enable 2FA
          </button>
        </form>
      </div>
    `;

    wrapper.querySelector('#verify-2fa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = wrapper.querySelector('#totp-code-input').value.trim();
      try {
        const res = await api.post('/api/auth/2fa/enable', {
          secret: setupData.secret,
          code
        });
        showToast('2FA enabled successfully!', 'success');
        user.totpEnabled = true;

        // Display Recovery Codes
        wrapper.innerHTML = `
          <div class="space-y-4 max-w-md text-xs">
            <h3 class="font-bold text-sm text-emerald-dark uppercase">2FA Enabled: One-Time Recovery Codes</h3>
            <p class="text-navy-600 leading-relaxed">
              Store these 8 emergency recovery codes in a safe place. If you lose your phone, each code can be used once to access your account:
            </p>
            <div class="p-4 bg-navy-50 rounded-xl font-mono text-sm grid grid-cols-2 gap-2 text-center border border-navy-200">
              ${res.recoveryCodes.map(rc => `<div>${rc}</div>`).join('')}
            </div>
          </div>
        `;
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

  } catch (err) {
    wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Failed to initiate 2FA: ${err.message}</div>`;
  }
}

async function renderSystemStatusSection(wrapper) {
  try {
    const data = await api.get('/api/admin/status');

    wrapper.innerHTML = `
      <div class="space-y-6 text-xs">
        <div class="flex justify-between items-center pb-3 border-b border-navy-100">
          <div>
            <h3 class="font-bold text-sm text-navy uppercase">Server Health & Host Status</h3>
            <span class="text-navy-500">Resource metrics for the on-premise Debian server</span>
          </div>
          <span class="px-2.5 py-1 rounded-full font-bold uppercase text-[10px] ${data.warnings.highDiskUsage || data.warnings.backupStale ? 'bg-rose-100 text-rose-700' : 'bg-emerald/10 text-emerald-dark'}">
            ${data.warnings.highDiskUsage || data.warnings.backupStale ? 'Attention Required' : 'Optimal'}
          </span>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="p-4 bg-navy-50 rounded-xl border border-navy-200">
            <span class="font-bold text-navy-400 block mb-1">Disk Usage</span>
            <span class="text-xl font-black ${data.warnings.highDiskUsage ? 'text-rose-600' : 'text-navy'}">${data.disk.usedPercent}%</span>
            <span class="text-[10px] text-navy-500 block">${(data.disk.freeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB free</span>
          </div>
          <div class="p-4 bg-navy-50 rounded-xl border border-navy-200">
            <span class="font-bold text-navy-400 block mb-1">RAM (Physical)</span>
            <span class="text-xl font-black text-navy">${data.memory.freeMb} MB</span>
            <span class="text-[10px] text-navy-500 block">of ${data.memory.totalMb} MB total</span>
          </div>
          <div class="p-4 bg-navy-50 rounded-xl border border-navy-200">
            <span class="font-bold text-navy-400 block mb-1">Database Size</span>
            <span class="text-xl font-black text-navy">${data.database.formatted}</span>
            <span class="text-[10px] text-navy-500 block">PostgreSQL 16</span>
          </div>
          <div class="p-4 bg-navy-50 rounded-xl border border-navy-200">
            <span class="font-bold text-navy-400 block mb-1">App Uptime</span>
            <span class="text-xl font-black text-navy">${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor((data.uptimeSeconds % 3600) / 60)}m</span>
            <span class="text-[10px] text-navy-500 block">node:24-bookworm-slim</span>
          </div>
        </div>

        <!-- Backup Status -->
        <div class="p-5 rounded-xl border ${data.backup.staleWarning ? 'bg-rose-50 border-rose-200' : 'bg-white border-navy-200'} space-y-2">
          <h4 class="font-bold text-navy text-xs uppercase">Automated Backup Health</h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <span class="text-navy-400 block">Last Backup:</span>
              <span class="font-bold text-navy">${data.backup.lastBackupTime ? formatDate(data.backup.lastBackupTime) : 'Never'}</span>
            </div>
            <div>
              <span class="text-navy-400 block">Off-Machine Sync:</span>
              <span class="font-bold text-navy">${data.backup.offMachineSync || 'Configured via rclone'}</span>
            </div>
            <div>
              <span class="text-navy-400 block">Disk Health (SMART):</span>
              <span class="font-bold text-emerald-dark">${data.smart.healthy ? 'PASSED' : 'CHECK HDD'}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
  }
}

function renderBackupSection(wrapper) {
  wrapper.innerHTML = `
    <div class="space-y-6 max-w-xl text-xs">
      <div>
        <h3 class="font-bold text-sm text-navy uppercase">In-App Encrypted Export & Restore</h3>
        <p class="text-navy-500 leading-relaxed mt-1">
          Export your complete store records into a portable package encrypted with a personal passphrase (scrypt + AES-256-GCM).
        </p>
      </div>

      <div class="p-5 bg-navy-50 rounded-xl border border-navy-200 space-y-3">
        <h4 class="font-bold text-navy">Export Encrypted Store Database</h4>
        <input type="password" id="export-pass" placeholder="Enter encryption passphrase (min 12 chars)" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        <button id="btn-run-export" class="bg-navy text-white font-bold px-4 py-2 rounded-xl shadow-card">Download Encrypted Package</button>
      </div>

      <div class="p-5 bg-navy-50 rounded-xl border border-navy-200 space-y-3">
        <h4 class="font-bold text-navy">Restore Encrypted Package</h4>
        <input type="file" id="restore-file" accept=".json" class="w-full">
        <input type="password" id="restore-pass" placeholder="Enter decryption passphrase" class="w-full px-3 py-2 rounded-xl border border-navy-200">
        <button id="btn-run-restore" class="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl shadow-card">Restore Database</button>
      </div>
    </div>
  `;

  wrapper.querySelector('#btn-run-export').addEventListener('click', async () => {
    const pass = wrapper.querySelector('#export-pass').value;
    if (pass.length < 12) {
      showToast('Passphrase must be at least 12 characters', 'error');
      return;
    }
    try {
      const data = await api.post('/api/backup/export', { passphrase: pass });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `devi_backup_${new Date().toISOString().slice(0, 10)}.enc.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Encrypted export downloaded', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  wrapper.querySelector('#btn-run-restore').addEventListener('click', async () => {
    const file = wrapper.querySelector('#restore-file').files[0];
    const pass = wrapper.querySelector('#restore-pass').value;
    if (!file || !pass) {
      showToast('Select a backup JSON file and enter passphrase', 'error');
      return;
    }

    const conf = await confirmDialog({
      title: 'Overwrite Database Warning',
      message: 'Restoring an export will overwrite existing store documents, products, and customer records. Proceed?',
      confirmText: 'Restore Now',
      isDestructive: true
    });
    if (!conf) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const pkg = JSON.parse(e.target.result);
        await api.post('/api/backup/restore', {
          passphrase: pass,
          package: pkg
        });
        showToast('Database restored successfully', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    };
    reader.readAsText(file);
  });
}

async function renderAuditSection(wrapper) {
  try {
    const data = await api.get('/api/admin/audit?limit=50');

    wrapper.innerHTML = `
      <div class="space-y-4 text-xs">
        <div class="pb-3 border-b border-navy-100">
          <h3 class="font-bold text-sm text-navy uppercase">System Audit Trail</h3>
          <span class="text-navy-500">Immutable ledger of administrative actions, logins, and document cancellations</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-navy-50 font-bold uppercase text-[10px] text-navy-700">
              <tr>
                <th class="py-2.5 px-3">Timestamp</th>
                <th class="py-2.5 px-3">User</th>
                <th class="py-2.5 px-3">Action</th>
                <th class="py-2.5 px-3">Target Entity</th>
                <th class="py-2.5 px-3">IP Address</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-navy-100">
              ${data.items.map(a => `
                <tr>
                  <td class="py-2 px-3 text-navy-500 font-mono text-[11px]">${formatDate(a.created_at)}</td>
                  <td class="py-2 px-3 font-bold text-navy">${a.username || '(system)'}</td>
                  <td class="py-2 px-3 font-mono text-navy-700">${a.action}</td>
                  <td class="py-2 px-3">${a.entity} ${a.entity_id ? '• ' + a.entity_id : ''}</td>
                  <td class="py-2 px-3 text-navy-500 font-mono">${a.client_ip}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    wrapper.innerHTML = `<div class="p-6 text-center text-xs text-rose-600">Error: ${err.message}</div>`;
  }
}

export default {
  renderSettings
};
