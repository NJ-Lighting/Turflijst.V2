// /js/nav.js
// Hamburger menu + wachtwoordbeveiligde admin-sectie met sublinks.
(function () {
  const btn = document.querySelector('.nav-toggle');
  const drawer = document.getElementById('nav-drawer');
  if (!btn || !drawer) return;

  // --- Basis hamburger functionaliteit ---
  const close = () => { drawer.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); };
  const toggle = () => {
    const openNow = drawer.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', openNow ? 'true' : 'false');
  };
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

  // --- Navigatie structuur ---
  // Bestaande knoppen in het hoofdmenu
  drawer.innerHTML = `
    <a href="/index.html">Home</a>
    <a href="/history.html">History</a>
    <a href="/new-user.html">New User</a>
    <a href="#" id="admin-protected">Admin</a>
  `;

  // --- Admin wachtwoordbeveiliging ---
  const ADMIN_PASS = '1915'; // 🔐 jouw wachtwoord
  const LS_KEY = 'turflijst_admin_unlocked';

  // Maak de verborgen admin-submenu container
  const adminRow = document.createElement('div');
  adminRow.id = 'nav-admin-row';
  adminRow.style.display = 'none';
  adminRow.innerHTML = `
    <div style="height:1px;background:rgba(255,255,255,.15);margin:.5rem 0;"></div>
    <div class="nav-admin-links" style="display:flex;flex-direction:column;gap:.3rem;padding-left:0.5rem;">
      <a href="/admin.html">→ Admin pagina</a>
      <a href="/stock.html">→ Voorraad pagina</a>
      <a href="/finance.html">→ Finance pagina</a>
      <a href="/payment.html">→ Payment pagina</a>
    </div>
  `;
  drawer.appendChild(adminRow);

  const setAdminVisible = (v) => {
    adminRow.style.display = v ? '' : 'none';
  };

  // Controleer of admin reeds ontgrendeld is
  const unlocked = localStorage.getItem(LS_KEY) === '1';
  setAdminVisible(unlocked);

  // --- Klikgedrag voor "Admin" knop ---
  const adminBtn = document.getElementById('admin-protected');
  if (adminBtn) {
    adminBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const already = localStorage.getItem(LS_KEY) === '1';
      if (already) {
        // toggle zichtbaarheid van subnavigatie
        adminRow.style.display = adminRow.style.display === 'none' ? '' : 'none';
        return;
      }
      const pwd = window.prompt('Voer admin-wachtwoord in:');
      if (pwd === null) return; // geannuleerd
      if (pwd === ADMIN_PASS) {
        localStorage.setItem(LS_KEY, '1');
        setAdminVisible(true);
        alert('Admin menu ontgrendeld.');
      } else {
        alert('Onjuist wachtwoord.');
      }
    });
  }
})();
