// /js/pages/payment.page.js
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import { loadUsersToSelects, loadPayments, addPayment, deletePayment } from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  // dropdowns & bestaande payments-lijst (onderaan)
  await loadUsersToSelects('#p-filter-user', '#p-user');
  await loadPayments('#p-rows', '#p-filter-user');

  // acties bestaande sectie
  $('#p-add')?.addEventListener('click', () =>
    addPayment('#p-user', '#p-amount', '#p-note', () => loadPayments('#p-rows', '#p-filter-user'))
  );
  $('#p-filter-user')?.addEventListener('change', () => loadPayments('#p-rows', '#p-filter-user'));

  // V1: openstaande saldi + tools
  await renderOpenBalances();
  // events voor zoek/admin
  $('#pb-search')?.addEventListener('input', renderOpenBalances);
  $('#pb-admin')?.addEventListener('click', toggleAdminMode);
});

// expose voor inline onclick uit payments-tabel
window.deletePayment = (id) =>
  deletePayment(id, () => loadPayments('#p-rows', '#p-filter-user'));

/* ---------------------------
 * Openstaande saldi (V1)
 * --------------------------- */

let ADMIN_MODE = false;

async function computeOpenBalances(searchTerm = '') {
  // users
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  // drinks: gebruik historische kostprijs, fallback = actuele products.price
  const { data: rows, error: dErr } = await supabase
    .from('drinks')
    .select('user_id, price_at_purchase, products(price)');
  if (dErr) throw dErr;

  // reduce per user
  const sumByUser = new Map();
  const countByUser = new Map();
  (rows || []).forEach((r) => {
    const price = Number(r?.price_at_purchase ?? r?.products?.price ?? 0);
    const uid = r.user_id;
    sumByUser.set(uid, (sumByUser.get(uid) || 0) + price);
    countByUser.set(uid, (countByUser.get(uid) || 0) + 1);
  });

  const q = (searchTerm || '').trim().toLowerCase();
  return (users || [])
    .map((u) => ({
      id: u.id,
      name: u.name,
      amount: sumByUser.get(u.id) || 0,
      count: countByUser.get(u.id) || 0,
    }))
    .filter((u) => !q || String(u.name || '').toLowerCase().includes(q))
    .filter((u) => u.amount > 0) // alleen wie echt iets open heeft
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function renderOpenBalances() {
  const search = $('#pb-search')?.value || '';
  let list = [];
  try {
    list = await computeOpenBalances(search);
  } catch (err) {
    console.error(err);
    return toast('❌ Kan openstaande saldi niet berekenen');
  }

  const rowsHtml = list
    .map((u) => {
      const uid = esc(u.id);
      const name = esc(u.name);
      const amountNum = Number(u.amount) || 0;
      const amount = euro(amountNum);
      const count = String(u.count);

      const actions = `
        <button class="btn btn-small" onclick="pbPayto('${uid}','${name}', ${amountNum.toFixed(2)})">PayTo</button>
        <button class="btn btn-small" onclick="pbShowQR('${uid}','${name}', ${amountNum.toFixed(2)})">QR</button>
        <button class="btn btn-small" onclick="pbCopyLink('${uid}','${name}', ${amountNum.toFixed(2)})">Kopieer link</button>
        ${ADMIN_MODE ? `<button class="btn btn-small" onclick="pbMarkPaid('${uid}')">✅ Betaald</button>` : ''}
      `;

      return `
        <tr>
          <td>${name}</td>
          <td>${count}</td>
          <td>${amount}</td>
          <td>${actions}</td>
        </tr>`;
    })
    .join('');

  if ($('#pb-rows'))
    $('#pb-rows').innerHTML = rowsHtml || '<tr><td colspan="4">Geen resultaten</td></tr>';
}

/* ---------------------------
 * Admin-modus (PIN 0000)
 * --------------------------- */
function toggleAdminMode() {
  if (!ADMIN_MODE) {
    const pin = prompt('Voer admin-PIN in:');
    if (pin !== '0000') return toast('❌ Onjuiste PIN');
    ADMIN_MODE = true;
  } else {
    ADMIN_MODE = false;
  }
  renderOpenBalances();
}

// Markeer als betaald: insert in payments en drinks wissen
window.pbMarkPaid = async (userId) => {
  // herbereken bedrag i.p.v. uit tabel te vertrouwen
  const balances = await computeOpenBalances('');
  const entry = balances.find((b) => b.id === userId);
  const amount = entry?.amount || 0;
  if (!(amount > 0)) return toast('Geen openstaand saldo');

  const extRef = `paypage-${userId}-${Date.now()}`;
  const { error: pErr } = await supabase
    .from('payments')
    .insert([{ user_id: userId, amount, ext_ref: extRef }]);
  if (pErr) {
    console.error(pErr);
    return toast('❌ Betaling registreren mislukt');
  }

  const { error: dErr } = await supabase.from('drinks').delete().eq('user_id', userId);
  if (dErr) {
    console.error(dErr);
    return toast('⚠️ Betaling opgeslagen, maar drankjes niet gewist');
  }

  toast(`✅ Betaald: ${euro(amount)}`);
  await renderOpenBalances();
  await loadPayments('#p-rows', '#p-filter-user');
};

/* ---------------------------
 * PayTo / QR / Link
 * --------------------------- */

// Stel je IBAN/naam/omschrijving samen:
const BANK_NAME = 'NJ-Lighting';
const BANK_IBAN = 'NL00BANK0123456789'; // <-- zet hier jouw IBAN
const BANK_BIC = 'BANKNL2A';            // <-- optioneel; voor EPC QR
const DESC_BASE = 'Drankjes koelkast';  // basisomschrijving

function buildPaytoLink(name, amount) {
  const euroStr = Number(amount || 0).toFixed(2);
  const params = new URLSearchParams({
    amount: euroStr,
    message: `${DESC_BASE} – ${name}`,
  });
  return `payto://iban/${BANK_IBAN}?${params.toString()}`;
}

function buildEpcPayload(name, amount) {
  // EPC069-12 (SEPA QR) payload
  // Service tag, version, character set, identification, BIC (opt), name, IBAN,
  // amount, purpose (opt), remittance (free text), info (opt)
  const amt = Number(amount || 0).toFixed(2);
  const lines = [
    'BCD',
    '001',
    '1',
    'SCT',
    BANK_BIC || '',
    BANK_NAME,
    BANK_IBAN,
    `EUR${amt}`,
    '', // purpose
    `${DESC_BASE} - ${name}`,
    '' // info
  ];
  return lines.join('\n');
}

window.pbPayto = (userId, name, amount) => {
  const url = buildPaytoLink(name, amount);
  try {
    window.location.href = url;
  } catch {
    toast('⚠️ Kon PayTo link niet openen');
  }
};

window.pbCopyLink = async (userId, name, amount) => {
  const url = buildPaytoLink(name, amount);
  try {
    await navigator.clipboard.writeText(url);
    toast('🔗 Link gekopieerd');
  } catch {
    toast('⚠️ Kopiëren mislukt');
  }
};

window.pbShowQR = async (userId, name, amount) => {
  const payload = buildEpcPayload(name, amount);
  // Simpele fallback: toon payload in een <pre id="qr-payload"> (optioneel modal)
  const pre = $('#qr-payload');
  const lbl = $('#qr-label');
  if (lbl) lbl.textContent = `${name} – ${euro(amount)}`;
  if (pre) pre.textContent = payload;
  $('#qr-modal')?.showModal?.();
};

window.pbCloseQR = () => $('#qr-modal')?.close?.();
