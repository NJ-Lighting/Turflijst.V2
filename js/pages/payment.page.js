// /js/pages/payment.page.js
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

// Globale (open) betaallink voor iedereen
let GLOBAL_PAYLINK = null; // string | null

// Alleen saldi-functionaliteit op deze pagina
document.addEventListener('DOMContentLoaded', async () => {
  await loadGlobalPayLink();     // laad globale betaallink (indien aanwezig)
  await renderOpenBalances();

  $('#pb-search')?.addEventListener('input', renderOpenBalances);
  $('#pb-admin')?.addEventListener('click', toggleAdminMode);
});

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

  // drinks: gebruik historische kostprijs; fallback = actuele products.price
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
    .filter((u) => u.amount > 0)
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

  // Admin: toon knop om de globale betaallink te beheren
  const controls = document.querySelector('.saldi-controls');
  const existingBtn = document.getElementById('pb-set-global-link');
  if (ADMIN_MODE && controls && !existingBtn) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.id = 'pb-set-global-link';
    btn.textContent = GLOBAL_PAYLINK ? '🔗 Betaallink wijzigen' : '🔗 Betaallink instellen';
    btn.addEventListener('click', () => pbSetGlobalPayLink());
    controls.appendChild(btn);
  } else if (!ADMIN_MODE && existingBtn) {
    existingBtn.remove();
  }

  const rowsHtml = list
    .map((u) => {
      const uid = esc(u.id);
      const name = esc(u.name);
      const amountNum = Number(u.amount) || 0;
      const amount = euro(amountNum);
      const count = String(u.count);

      const actions = `
        <button class="btn btn-small"
          onclick="pbPayto('${uid}','${name}', ${amountNum.toFixed(2)})">Betalen</button>
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

  // Insert zonder ext_ref
  const { error: pErr } = await supabase
    .from('payments')
    .insert([{ user_id: userId, amount }]);
  if (pErr) {
    console.error(pErr);
    return toast('❌ Betaling registreren mislukt');
  }

  // Alle onbetaalde drankjes van deze user wissen
  const { error: dErr } = await supabase.from('drinks').delete().eq('user_id', userId);
  if (dErr) {
    console.error(dErr);
    return toast('⚠️ Betaling opgeslagen, maar drankjes niet gewist');
  }

  toast(`✅ Betaald: ${euro(amount)}`);
  await renderOpenBalances();
};

/* ---------------------------
 * Globale betaallink + fallback naar PayTo
 * --------------------------- */

// IBAN fallback (PayTo)
const BANK_IBAN = 'NL00BANK0123456789'; // <-- zet hier jouw IBAN
const DESC_BASE = 'Drankjes koelkast';

function buildPaytoLink(name, amount) {
  const euroStr = Number(amount || 0).toFixed(2);
  const params = new URLSearchParams({
    amount: euroStr,
    message: `${DESC_BASE} – ${name}`,
  });
  return `payto://iban/${BANK_IBAN}?${params.toString()}`;
}

// Laden van de globale link (probeer 'settings', anders 'payment_links' met 1 rij)
async function loadGlobalPayLink() {
  try {
    const { data: sdata, error: serr } = await supabase
      .from('settings')
      .select('key, value')
      .eq('key', 'global_paylink')
      .maybeSingle();
    if (!serr && sdata?.value) {
      GLOBAL_PAYLINK = String(sdata.value);
      return;
    }
  } catch (_) {}
  try {
    const { data: pdata, error: perr } = await supabase
      .from('payment_links')
      .select('url')
      .limit(1);
    if (!perr && Array.isArray(pdata) && pdata[0]?.url) {
      GLOBAL_PAYLINK = String(pdata[0].url);
      return;
    }
  } catch (_) {}
  GLOBAL_PAYLINK = null;
}

// Admin: instellen/wijzigen/verwijderen van de globale link
window.pbSetGlobalPayLink = async () => {
  const current = GLOBAL_PAYLINK || '';
  const url = prompt('Voer de OPEN betaallink in (leeg = verwijderen):', current);
  if (url === null) return; // geannuleerd

  try {
    if ((url || '').trim() === '') {
      // verwijderen uit settings
      let ok = false;
      try {
        const { error } = await supabase.from('settings')
          .delete()
          .eq('key', 'global_paylink');
        if (!error) ok = true;
      } catch (_) {}
      // fallback: payment_links leegmaken
      if (!ok) {
        try { await supabase.from('payment_links').delete().neq('url', null); } catch (_) {}
      }
      GLOBAL_PAYLINK = null;
      toast('🔗 Betaallink verwijderd');
    } else {
      const clean = url.trim();
      // upsert in settings
      let ok = false;
      try {
        const { error } = await supabase.from('settings')
          .upsert({ key: 'global_paylink', value: clean }, { onConflict: 'key' });
        if (!error) ok = true;
      } catch (_) {}
      // fallback: payment_links met één rij
      if (!ok) {
        await supabase.from('payment_links').delete().neq('url', null);
        const { error } = await supabase.from('payment_links').insert([{ url: clean }]);
        if (error) throw error;
      }
      GLOBAL_PAYLINK = clean;
      toast('🔗 Betaallink opgeslagen');
    }
  } catch (e) {
    console.error(e);
    return toast('❌ Betaallink instellen mislukt');
  }

  // update knoplabel in controls
  const btn = document.getElementById('pb-set-global-link');
  if (btn) btn.textContent = GLOBAL_PAYLINK ? '🔗 Betaallink wijzigen' : '🔗 Betaallink instellen';
};

// Betalen-knop: eerst globale link, anders IBAN PayTo fallback
window.pbPayto = (userId, name, amount) => {
  const direct = GLOBAL_PAYLINK;
  if (direct) {
    try { window.location.href = direct; return; }
    catch { /* val door naar PayTo */ }
  }
  const url = buildPaytoLink(name, amount);
  try { window.location.href = url; }
  catch { toast('⚠️ Kon betaallink niet openen'); }
};
