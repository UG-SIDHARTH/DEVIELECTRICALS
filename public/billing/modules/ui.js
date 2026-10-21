const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatMoney(paise) {
  const rupees = (Number(paise) || 0) / 100;
  return currencyFormatter.format(rupees);
}

export function formatQty(qty, unit = 'Nos') {
  const n = Number(qty) || 0;
  // If whole number, format without decimals, else up to 3 decimals
  const formatted = n % 1 === 0 ? n.toFixed(0) : n.toFixed(3).replace(/\.?0+$/, '');
  return `${formatted} ${unit}`;
}

export function formatDate(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export function showToast(message, type = 'info', action = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl shadow-card-hover text-sm font-semibold transition-all transform duration-200 translate-y-2 opacity-0 max-w-sm';

  if (type === 'success') {
    toast.className += ' bg-emerald text-white';
  } else if (type === 'error') {
    toast.className += ' bg-rose-600 text-white';
  } else if (type === 'warning') {
    toast.className += ' bg-amber text-navy';
  } else {
    toast.className += ' bg-navy text-white';
  }

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (action && action.label && action.onClick) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'underline ml-2 text-xs font-bold hover:opacity-80';
    actionBtn.textContent = action.label;
    actionBtn.addEventListener('click', () => {
      action.onClick();
      toast.remove();
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

export function confirmDialog({ title, message, confirmText = 'Confirm', isDestructive = false }) {
  return new Promise((resolve) => {
    const container = document.getElementById('modal-container');
    if (!container) return resolve(false);

    container.innerHTML = '';
    container.classList.remove('hidden');

    const modal = document.createElement('div');
    modal.className = 'bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-border';

    const h3 = document.createElement('h3');
    h3.className = 'text-lg font-bold text-navy mb-2';
    h3.textContent = title;

    const p = document.createElement('p');
    p.className = 'text-sm text-navy-600 leading-relaxed mb-6';
    p.textContent = message;

    const btnRow = document.createElement('div');
    btnRow.className = 'flex justify-end gap-3';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-4 py-2 rounded-xl border border-navy-200 text-sm font-semibold text-navy-700 hover:bg-navy-50';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      container.classList.add('hidden');
      resolve(false);
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = isDestructive
      ? 'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold'
      : 'px-4 py-2 rounded-xl bg-navy hover:bg-navy-800 text-white text-sm font-semibold';
    confirmBtn.textContent = confirmText;
    confirmBtn.addEventListener('click', () => {
      container.classList.add('hidden');
      resolve(true);
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);

    modal.appendChild(h3);
    modal.appendChild(p);
    modal.appendChild(btnRow);

    container.appendChild(modal);
  });
}

export default {
  formatMoney,
  formatQty,
  formatDate,
  showToast,
  confirmDialog
};
