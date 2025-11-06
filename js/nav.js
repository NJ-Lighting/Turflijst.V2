// /js/nav.js
// Hamburger menu + wachtwoordbeveiligde admin-subnavigatie.
// Verplaatst bestaande admin/voorraad/finance/payment-links vanuit het hoofdmenu
// naar een verborgen rij die pas zichtbaar wordt na wachtwoord.
(function () {
  const btn = document.querySelector('.nav-toggle');
  const drawer = document.getElementById('nav-drawer');
  if (!btn || !drawer) return;

  // --- Basis hamburger ---
  const close = () => { drawer.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); };
  const toggle = () => { const openNow = drawer.classList.toggle('is-open'); btn.setAttribute('aria-expanded', openNow ? 'true' : 'false'); };
  btn.addEventListener('click', toggle);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) close();
  });

  document.addEventListener('click', (e) => {
    if (!drawer.classList.contains('is-open')) return;
    const withinDrawer = drawer.contains(e.target);
    const withinButton = btn.contains(e.target);
    if (!withinDrawer && !withinButton) close();
  });

  // --- Config ---
  const ADMIN_PASS = '1915';            // wachtwoord
  const ADMIN_PATHS = ['/admin.html', '/stock.html', '/finance.html', '/payment.html'];

  // --- Admin-submenu container (verborgen) ---
  let adminRow = drawer.querySelector('#nav-admin-row');
  if (!adminRow) {
    adminRow = document.createElement('div');
    adminRow.id = 'nav-admin-row';
    adminRow.style.display = 'none';
    adminRow.innerHTML = `
      <div style="height:1px;background:rgba(255,255,255,.15);margin:.5rem 0;"></div>
      <div class="nav-admin-links" style="display:flex;flex-direction:column;gap:.3rem;padding-left:.5rem;"></div>
    `;
    drawer.appendChild(adminRow);
  }
  const adminLinksContainer = adminRow.querySelector('.nav-admin-links');

  // --- Bestaande admin-achtige links uit hoofdmenu verplaatsen ---
  const allLinks = Array.from(drawer.querySelectorAll('a'));
  const isAdminDest = (a) => {
    const href = (a.getAttribute('href') || '').trim().toLowerCase();
    return ADMIN_PATHS.includes(href);
  };

  // Vind of maak de bovenste "Admin" knop (trigger)
  let adminTrigger = allLinks.find(a => {
    const t = (a.textContent || '').trim().toLowerCase();
    return t === 'admin' && !isAdminDest(a);
  });
  if (!adminTrigger) {
    // Maak een aparte Admin-trigger na "New User" als die nog niet bestaat
    adminTrigger = document.createElement('a');
    adminTrigger.href = '#';
    adminTrigger.textContent = 'Admin';
    drawer.appendChild(adminTrigger);
  }
  adminTrigger.id = 'admin-protected';

  // Verplaats alle bestaande admin-bestemmingen naar het submenu (weg uit hoofdmenu)
  allLinks.forEach(a => {
    if (isAdminDest(a)) {
      adminLinksContainer.appendChild(a); // move node, voorkomt dubbele knoppen
    }
  });

  // Als sommige admin-links niet in de HTML stonden, voeg ze toe zodat set compleet is
  const ensureLink = (href, label) => {
    if (!Array.from(adminLinksContainer.querySelectorAll('a')).some(a => (a.getAttribute('href') || '').toLowerCase() === href)) {
      const el = document.createElement('a');
      el.href = href;
      el.textContent = label;
      adminLinksContainer.appendChild(el);
    }
  };
  ensureLink('/admin.html', '→ Admin pagina');
  ensureLink('/stock.html', '→ Voorraad pagina');
  ensureLink('/finance.html', '→ Finance pagina');
  ensureLink('/payment.html', '→ Payment pagina');

  // Bij laden: submenu verborgen (geen persistentie tussen pagina's)
  const setAdminVisible = (v) => { adminRow.style.display = v ? '' : 'none'; };
  setAdminVisible(false);

  // Klik op "Admin" vraagt wachtwoord en toont/verbergt submenu
  adminTrigger.addEventListener('click', (e) => {
    e.preventDefault();
    if (adminRow.style.display !== 'none') {
      setAdminVisible(false);
      return;
    }
    const pwd = window.prompt('Voer admin-wachtwoord in:');
    if (pwd === null) return;
    if (pwd === ADMIN_PASS) {
      setAdminVisible(true);
    } else {
      alert('Onjuist wachtwoord.');
    }
  });
})();
