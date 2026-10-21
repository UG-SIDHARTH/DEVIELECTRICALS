import api, { setCsrfToken, setAuthFailureHandler } from './modules/api.js';
import state, { getState, setUser, setRoute, subscribe } from './modules/state.js';
import { showToast } from './modules/ui.js';

// Submodules
import { renderDashboard } from './modules/dashboard.js';
import { renderProducts } from './modules/products.js';
import { renderDocuments } from './modules/documents.js';
import { renderCustomers } from './modules/customers.js';
import { renderSuppliers } from './modules/suppliers.js';
import { renderExpenses } from './modules/expenses.js';
import { renderReports } from './modules/reports.js';
import { renderSettings } from './modules/settings.js';
import { renderScan } from './modules/scan.js';

const appRoot = document.getElementById('app');

// 1. Idle Timeout Tracking (30-minute session, warning at 28 mins)
let lastActivity = Date.now();
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const WARN_LIMIT_MS = 28 * 60 * 1000;
let warned = false;

['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, () => {
    lastActivity = Date.now();
    warned = false;
  }, { passive: true });
});

setInterval(() => {
  const current = getState().currentUser;
  if (!current) return;

  const elapsed = Date.now() - lastActivity;
  if (elapsed > IDLE_LIMIT_MS) {
    showToast('Session timed out due to inactivity.', 'warning');
    handleLogout();
  } else if (elapsed > WARN_LIMIT_MS && !warned) {
    warned = true;
    showToast('Your session will expire in 2 minutes due to inactivity.', 'warning');
  }
}, 30000);

// 2. Authentication Failure Handler (401 from any API call)
setAuthFailureHandler(() => {
  setUser(null);
  renderLogin();
});

// 3. Render Login Screen
function renderLogin(requireTotp = false, savedUsername = '') {
  appRoot.innerHTML = `
    <div class="min-h-screen bg-navy flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8">
      <div class="max-w-md w-full space-y-8 bg-white p-8 rounded-3xl shadow-2xl border border-surface-border">
        <div class="text-center">
          <div class="w-12 h-12 rounded-2xl bg-amber mx-auto flex items-center justify-center shadow-glow mb-4">
            <svg class="w-7 h-7 text-navy" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Staff Portal Login</h2>
          <p class="text-xs text-navy-500 mt-1">Devi Electrical • Kazhakkoottam</p>
        </div>

        <form id="login-form" class="mt-8 space-y-4 text-xs">
          <div>
            <label class="block font-bold text-navy-700 mb-1">Username</label>
            <input type="text" id="login-username" required value="${savedUsername}" autocomplete="username" class="w-full text-xs px-3.5 py-2.5 rounded-xl border border-navy-200 focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber">
          </div>

          <div>
            <label class="block font-bold text-navy-700 mb-1">Password</label>
            <input type="password" id="login-password" required autocomplete="current-password" class="w-full text-xs px-3.5 py-2.5 rounded-xl border border-navy-200 focus:outline-none focus:border-amber focus:ring-1 focus:ring-amber">
          </div>

          ${requireTotp ? `
            <div class="pt-2 border-t border-navy-100">
              <label class="block font-bold text-navy-700 mb-1">Two-Factor Authenticator Code (or Recovery Code)</label>
              <input type="text" id="login-totp" required maxlength="10" placeholder="000000" autocomplete="one-time-code" class="w-full text-center font-mono text-base tracking-widest px-3.5 py-2 rounded-xl border border-amber focus:outline-none">
            </div>
          ` : ''}

          <div id="login-error" class="hidden p-3 bg-rose-50 border border-rose-200 text-rose-700 font-semibold rounded-xl text-xs"></div>

          <button type="submit" id="btn-login-submit" class="w-full bg-navy hover:bg-navy-800 text-white font-bold py-3 px-4 rounded-xl shadow-card transition-all flex items-center justify-center gap-2">
            <span>Sign In to Dashboard</span>
          </button>
        </form>

        <div class="text-center pt-4 border-t border-navy-100">
          <a href="/" class="text-xs font-semibold text-navy-500 hover:text-amber transition-colors">← Back to public website</a>
        </div>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  const errDiv = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errDiv.classList.add('hidden');

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const totpCode = document.getElementById('login-totp')?.value.trim() || undefined;

    try {
      const data = await api.post('/api/auth/login', {
        username,
        password,
        totp_code: totpCode
      });

      if (data.requireTotp) {
        renderLogin(true, username);
        return;
      }

      setCsrfToken(data.csrfToken);
      setUser(data.user);
      renderAppShell();
      setRoute('dashboard');
    } catch (err) {
      errDiv.textContent = err.message || 'Invalid username or password';
      errDiv.classList.remove('hidden');
    }
  });
}

// 4. Render Authenticated App Shell (Sidebar + Main Content + Mobile Tab Bar)
function renderAppShell() {
  const user = getState().currentUser;
  const isOwner = user?.role === 'owner';

  appRoot.innerHTML = `
    <div class="h-full flex flex-col md:flex-row bg-surface-bg overflow-hidden">
      <!-- Desktop Sidebar -->
      <aside class="hidden md:flex flex-col w-64 bg-navy text-white flex-shrink-0 border-r border-navy-800">
        <div class="h-16 px-6 flex items-center justify-between border-b border-navy-800">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-lg bg-amber flex items-center justify-center">
              <svg class="w-4 h-4 text-navy" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <span class="font-extrabold text-sm tracking-tight">Devi Electrical</span>
          </div>
        </div>

        <!-- Navigation Links -->
        <nav class="flex-grow p-4 space-y-1 overflow-y-auto text-xs" id="desktop-sidebar-nav">
          <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="dashboard">
            <span>📊</span> Dashboard
          </button>
          <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="documents">
            <span>📄</span> Documents & Bills
          </button>
          <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="products">
            <span>📦</span> Products & Stock
          </button>
          <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="scan">
            <span>📷</span> Photo-Scan List
          </button>
          <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="customers">
            <span>👥</span> Customers
          </button>
          <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="suppliers">
            <span>🏭</span> Suppliers
          </button>
          <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="expenses">
            <span>💸</span> Expenses
          </button>
          <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="reports">
            <span>📈</span> Reports & GST
          </button>
          ${isOwner ? `
            <button class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold transition-colors" data-route="settings">
              <span>⚙️</span> Settings & Admin
            </button>
          ` : ''}
        </nav>

        <!-- User Info & Logout -->
        <div class="p-4 border-t border-navy-800 text-xs flex items-center justify-between">
          <div>
            <span class="font-bold block text-white">${user?.username}</span>
            <span class="text-[10px] text-navy-400 uppercase font-semibold">${user?.role}</span>
          </div>
          <button id="btn-logout" class="p-2 text-navy-400 hover:text-white" title="Logout">🚪</button>
        </div>

        <div class="px-4 pb-3">
          <a href="/" class="text-[11px] font-semibold text-navy-400 hover:text-amber transition-colors">← Back to website</a>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="flex-grow flex flex-col h-full overflow-hidden">
        <header class="h-16 px-6 bg-white border-b border-surface-border flex items-center justify-between md:hidden">
          <span class="font-extrabold text-sm text-navy">Devi Electrical</span>
          <button id="btn-mobile-logout" class="text-xs font-bold text-navy-500">Logout</button>
        </header>

        <div id="billing-content" class="flex-grow p-4 sm:p-6 lg:p-8 overflow-y-auto pb-24 md:pb-8">
          <!-- Active submodule renders here -->
        </div>
      </main>

      <!-- Mobile Bottom Tab Bar (below md) -->
      <nav class="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-surface-border flex justify-around p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[10px] font-bold text-navy-600 shadow-2xl">
        <button class="mobile-tab flex flex-col items-center p-1" data-route="dashboard">
          <span class="text-base">📊</span> Home
        </button>
        <button class="mobile-tab flex flex-col items-center p-1" data-route="documents">
          <span class="text-base">📄</span> Bills
        </button>
        <button class="mobile-tab flex flex-col items-center p-1" data-route="scan">
          <span class="text-base">📷</span> Scan
        </button>
        <button class="mobile-tab flex flex-col items-center p-1" data-route="products">
          <span class="text-base">📦</span> Stock
        </button>
        <button class="mobile-tab flex flex-col items-center p-1" data-route="reports">
          <span class="text-base">📈</span> Reports
        </button>
      </nav>
    </div>
  `;

  // Attach Navigation Listeners
  const desktopNav = document.getElementById('desktop-sidebar-nav');
  desktopNav?.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => setRoute(btn.dataset.route));
  });

  document.querySelectorAll('.mobile-tab').forEach(btn => {
    btn.addEventListener('click', () => setRoute(btn.dataset.route));
  });

  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-mobile-logout')?.addEventListener('click', handleLogout);
}

async function handleLogout() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    // Ignore network error during logout
  }
  setCsrfToken(null);
  setUser(null);
  renderLogin();
}

// 5. Reactive Route Dispatcher
subscribe((st) => {
  if (!st.currentUser) return;

  const contentArea = document.getElementById('billing-content');
  if (!contentArea) return;

  // Highlight active nav item
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.dataset.route === st.currentRoute) {
      el.className = 'nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold bg-navy-800 text-amber shadow-card';
    } else {
      el.className = 'nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-bold text-navy-300 hover:text-white hover:bg-navy-900 transition-colors';
    }
  });

  document.querySelectorAll('.mobile-tab').forEach(el => {
    if (el.dataset.route === st.currentRoute) {
      el.className = 'mobile-tab flex flex-col items-center p-1 text-amber-dark';
    } else {
      el.className = 'mobile-tab flex flex-col items-center p-1 text-navy-600';
    }
  });

  // Render view
  switch (st.currentRoute) {
    case 'dashboard':
      renderDashboard(contentArea);
      break;
    case 'products':
      renderProducts(contentArea);
      break;
    case 'documents':
      renderDocuments(contentArea, st.routeParams);
      break;
    case 'customers':
      renderCustomers(contentArea);
      break;
    case 'suppliers':
      renderSuppliers(contentArea);
      break;
    case 'expenses':
      renderExpenses(contentArea);
      break;
    case 'reports':
      renderReports(contentArea, st.routeParams);
      break;
    case 'settings':
      renderSettings(contentArea, st.routeParams);
      break;
    case 'scan':
      renderScan(contentArea);
      break;
    default:
      renderDashboard(contentArea);
  }
});

// 6. Application Initial Boot Check
async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    const csrfData = await api.get('/api/auth/csrf');
    setCsrfToken(csrfData.csrfToken);
    setUser(me.user);

    // Fetch store configuration
    try {
      const s = await api.get('/api/settings');
      state.setStoreSettings(s);
    } catch {
      // Non-owner accounts will get 403 on settings; ignore
    }

    renderAppShell();
    setRoute('dashboard');
  } catch {
    // Not logged in or expired session
    renderLogin();
  }
}

boot();
