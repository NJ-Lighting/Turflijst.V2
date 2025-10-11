// Eenvoudige hamburger toggle met toegankelijkheid + Escape om te sluiten
const btn = document.querySelector('.nav-toggle');
const drawer = document.getElementById('nav-drawer');

if (btn && drawer) {
  const close = () => {
    drawer.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    drawer.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  };
  const toggle = () => {
    const openNow = drawer.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', openNow ? 'true' : 'false');
  };

  btn.addEventListener('click', toggle);

  // Sluit met Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) close();
  });

  // Klik buiten het paneel sluit het menu
  document.addEventListener('click', (e) => {
    if (!drawer.classList.contains('is-open')) return;
    const withinDrawer = drawer.contains(e.target);
    const withinButton = btn.contains(e.target);
    if (!withinDrawer && !withinButton) close();
  });
}
