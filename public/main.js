/**
 * Public Landing Page Interactive Logic.
 * Strict CSP compliant: No inline handlers or evals.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Dynamic Copyright Year
  const yearEl = document.getElementById('current-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // 2. Mobile Hamburger Navigation
  const menuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');

  if (menuBtn && mobileMenu) {
    const toggleMenu = () => {
      const isHidden = mobileMenu.classList.contains('hidden');
      if (isHidden) {
        mobileMenu.classList.remove('hidden');
        menuBtn.setAttribute('aria-expanded', 'true');
      } else {
        mobileMenu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    };

    menuBtn.addEventListener('click', toggleMenu);

    // Close on navigation link tap
    const links = mobileMenu.querySelectorAll('.mobile-nav-link');
    links.forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !mobileMenu.classList.contains('hidden')) {
        mobileMenu.classList.add('hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 3. Quick WhatsApp Inquiry Form
  const form = document.getElementById('inquiry-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('inq-name')?.value.trim() || '';
      const phone = document.getElementById('inq-phone')?.value.trim() || '';
      const list = document.getElementById('inq-list')?.value.trim() || '';

      if (!name || !list) {
        alert('Please provide your name and required material list.');
        return;
      }

      let message = `Hi Devi Electrical,\nMy name is ${name}.`;
      if (phone) {
        message += `\nPhone: ${phone}`;
      }
      message += `\n\nI would like to inquire about the following electrical materials:\n${list}`;

      const waUrl = `https://wa.me/919447220411?text=${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    });
  }
});
