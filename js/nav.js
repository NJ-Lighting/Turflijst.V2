// /js/nav.js
// Hamburger toggle + Admin-ontgrendeling zonder persistentie (opnieuw vragen na paginawissel).
(function () {
  const btn = document.querySelector('.nav-toggle');
  const drawer = document.getElementById('nav-drawer');
  if (!btn || !drawer) return;

  // --- Basis hamburger gedrag ---
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

  // --- Admin unlock (niet persistent) ---
  const ADMIN_PASS = '1915';

  // Extra rij met admin-links (verstopt totdat wachtwoord klopt)
  let adminRow = drawer.querySelector('#nav-admin-row');
  if (!adminRow) {
    adminRow = document.createElement('div');
    adminRow.id = 'nav-admin-row';
    adminRow.style.display = 'none';
    adminRow.innerHTML = `
      <div style="height:1px;background:rgba(255,255,255,.15);margin:.25rem 0;"></div>
      <div class="nav-admin-links" style="display:flex;flex-direction:column;gap:.3rem;padding-left:.5rem;">
        <a href="/admin.html">→ Admin pagina</a>
        <a href="/stock.html">→ Voorraad pagina</a>
        <a href="/finance.html">→ Finance pagina</a>
        <a href="/payment.html">→ Payment pagina</a>
      </div>
    `;
    drawer.appendChild(adminRow);
  }

  // Verberg adminrow standaard op iedere pagina-load (geen localStorage)
  const setAdminVisible = (v) => { adminRow.style.display = v ? '' : 'none'; };
  setAdminVisible(false);

  // Vind de bestaande "Admin" knop in de hoofdnav (HTML blijft leidend)
  const topAdminLink = Array.from(drawer.querySelectorAll('a')).find(a => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    const txt = (a.textContent || '').trim().toLowerCase();
    return href.includes('/admin.html') || txt === 'admin';
  });

  if (topAdminLink) {
    topAdminLink.addEventListener('click', (e) => {
      e.preventDefault();
      const pwd = window.prompt('Voer admin-wachtwoord in:');
      if (pwd === null) return; // geannuleerd
      if (pwd === ADMIN_PASS) {
        // Toon subnavigatie voor deze pagina-sessie
        setAdminVisible(true);
      } else {
        alert('Onjuist wachtwoord.');
      }
    }, { passive: false });
  }
})();
