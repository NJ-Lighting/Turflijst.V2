// /js/nav.js
// Hamburger toggle + Admin-ontgrendeling die extra admin-knoppen toont.
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

  // --- Admin unlock ---
  // LET OP: Pas hier jouw gewenste wachtwoord aan.
  const ADMIN_PASS = 'admin';
  const LS_KEY = 'turflijst_admin_unlocked';

  // Maak/haal admin-sectie (extra rij met knoppen)
  let adminRow = drawer.querySelector('#nav-admin-row');
  if (!adminRow) {
    adminRow = document.createElement('div');
    adminRow.id = 'nav-admin-row';
    adminRow.style.display = 'none';
    adminRow.innerHTML = `
      <div style="height:1px;background:rgba(255,255,255,.15);margin:.25rem 0;"></div>
      <div class="nav-admin-links" style="display:flex;gap:.5rem;flex-wrap:wrap">
        <a href="/admin.html">Admin</a>
        <a href="/stock.html">Voorraad</a>
        <a href="/payment.html">Payment</a>
      </div>
    `;
    drawer.appendChild(adminRow);
  }

  function setAdminVisible(v) {
    adminRow.style.display = v ? '' : 'none';
  }

  // Toon admin-rij als reeds ontgrendeld (persist via localStorage)
  const unlocked = localStorage.getItem(LS_KEY) === '1';
  setAdminVisible(unlocked);

  // Intercepteer de bestaande "Admin" link in de bovenste rij:
  // - Als nog niet ontgrendeld: prompt om wachtwoord; bij succes: ontgrendel + ga naar /admin.html
  // - Als al ontgrendeld: laat normale navigatie door
  const topAdminLink = Array.from(drawer.querySelectorAll('a')).find(a => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    const text = (a.textContent || '').trim().toLowerCase();
    return href.includes('/admin.html') || text === 'admin';
  });

  if (topAdminLink) {
    topAdminLink.addEventListener('click', (e) => {
      const already = localStorage.getItem(LS_KEY) === '1';
      if (already) return; // laat gewoon door
      e.preventDefault();
      const pwd = window.prompt('Vul het admin-wachtwoord in:');
      if (pwd === null) return; // geannuleerd
      if (pwd === 1915) {
        localStorage.setItem(LS_KEY, '1');
        setAdminVisible(true);
        // navigeer alsnog naar Admin
        window.location.href = '/admin.html';
      } else {
        // fallback melding zonder afhankelijkheid van core.js
        alert('Onjuist wachtwoord.');
      }
    }, { passive: false });
  }
})();
