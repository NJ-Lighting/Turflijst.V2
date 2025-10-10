// type: module

/** @param {string} sel */
export const $ = (sel) => document.querySelector(sel);

/** @param {string} sel */
export const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** €-format */
export function euro(v) {
  const n = Number.isFinite(Number(v)) ? Number(v) : 0;
  return `€${n.toFixed(2).replace('.', ',')}`;
}

/** HTML escapen (veilig voor innerHTML) */
export function esc(s) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(s ?? '').replace(/[&<>"']/g, (ch) => map[ch]);
}

/** NL datum/tijd weergave (veilig bij ongeldige input) */
export function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString('nl-NL');
  } catch {
    return iso || '';
  }
}

/** Light toast helper (geen deps) */
export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = String(msg ?? '');
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,.8)',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '10px',
    zIndex: 9999,
    transition: 'opacity .25s ease',
  });
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 1800);
}
