// /js/pages/payment.page.js
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

let GLOBAL_PAYLINK = null;            // open ING-link
let PAYMENT_FLAGS = new Map();        // user_id -> attempted_at (ISO)

document.addEventListener('DOMContentLoaded', async () => {
  await loadGlobalPayLink();          // via view_payment_link_latest
  await loadPaymentFlags();           // haal bestaande meldingen
  await renderOpenBalances();         // render tabel

  $('#pb-search')?.addEventListener('input', renderOpenBalances);
  $('#pb-admin')?.addEventListener('click', toggleAdminMode);
});

/* ---------------------------
 * Openstaande saldi
 * --------------------------- */
let ADMIN_MODE = false;

async function computeOpenBalances(searchTerm = '') {
  const { data: users } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });

  const { data: rows } = await supabase
    .from('drinks')
    .select('user_id, price_at_purchase, products(price)');

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
  try { list = await computeOpenBalances(search); }
  catch (err) { console.error(err); return toast('❌ Kan openstaande saldi niet berekenen'); }

  // admin-knop voor betaallink
  const controls = document.querySelector('.saldi-controls');
  const existingBtn = document.getElementById('pb-set-global-link');
  if (ADMIN_MODE && controls && !existingBtn) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.id = 'pb-set-global-link';
    btn.textContent = GLOBAL_PAYLINK ? ' Betaallink wijzigen' : ' Betaallink instellen';
    btn.addEventListener('click', () => pbSetGlobalPayLink());
    controls.appendChild(btn);
  } else if (!ADMIN_MODE && existingBtn) {
    existingBtn.remove();
  }

  const rowsHtml = list.map((u) => {
    const uid = esc(u.id);
    const name = esc(u.name);
    const amountNum = Number(u.amount) || 0;
    const amount = euro(amountNum);
    const count = String(u.count);

    const attemptISO = PAYMENT_FLAGS.get(u.id) || null;
    const attemptText = attemptISO
      ? new Date(attemptISO).toLocaleString('nl-NL', { 
          day:'2-digit', month:'2-digit', year:'numeric', 
          hour:'2-digit', minute:'2-digit' 
        })
      : null;
    const attemptCell = ADMIN_MODE
      ? (attemptISO ? `🕓 <small title="Gemeld op: ${attemptText}">${attemptText}</small>` : '—')
      : '—';

    const actions = `
      <button class="btn btn-small" onclick="pbPayto('${uid}','${name}', ${amountNum.toFixed(2)})">Betalen</button>
      ${ADMIN_MODE ? `<button class="btn btn-small" onclick="pbMarkPaid('${uid}')">✅ Betaald</button>` : ''}
    `;

    return `
      <tr>
        <td>${name}</td>
        <td>${count}</td>
        <td>${amount}</td>
        <td>${attemptCell}</td>
        <td>${actions}</td>
      </tr>`;
  }).join('');

  if ($('#pb-rows'))
    $('#pb-rows').innerHTML = rowsHtml || '<tr><td colspan="5">Geen resultaten</td></tr>';
}

/* ---------------------------
 * Admin-modus
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

/* ---------------------------
 * Betaallink (view) + beheer
 * --------------------------- */
async function loadGlobalPayLink() {
  try {
    const { data, error } = await supabase
      .from('view_payment_link_latest')
      .select('link, timestamp')
      .maybeSingle();
    if (!error && data?.link) {
      GLOBAL_PAYLINK = String(data.link);
      console.log('[global_paylink]', GLOBAL_PAYLINK, 'timestamp:', data.timestamp);
      return;
    }
  } catch (err) {
    console.warn('[global_paylink] view niet gevonden:', err?.message || err);
  }
  GLOBAL_PAYLINK = null;
}

window.pbSetGlobalPayLink = async () => {
  const current = GLOBAL_PAYLINK || '';
  const url = prompt('Voer de OPEN betaallink in (leeg = verwijderen):', current);
  if (url === null) return;
  try {
    if ((url || '').trim() === '') {
      await supabase.from('payment_links').delete().neq('id', null);
      GLOBAL_PAYLINK = null;
      toast(' Betaallink verwijderd');
    } else {
      const clean = url.trim();
      await supabase.from('payment_links').delete().neq('id', null);
      const { error } = await supabase.from('payment_links').insert([{ link: clean }]);
      if (error) throw error;
      GLOBAL_PAYLINK = clean;
      toast(' Betaallink opgeslagen');
    }
  } catch (e) {
    console.error(e);
    return toast('❌ Betaallink instellen mislukt');
  }
  const btn = document.getElementById('pb-set-global-link');
  if (btn) btn.textContent = GLOBAL_PAYLINK ? ' Betaallink wijzigen' : ' Betaallink instellen';
};

/* ---------------------------
 * Betaalmeldingen (flags)
 * --------------------------- */
async function loadPaymentFlags() {
  try {
    PAYMENT_FLAGS.clear();
    const { data } = await supabase
      .from('payment_flags')
      .select('user_id, attempted_at');
    for (const r of (data || [])) PAYMENT_FLAGS.set(r.user_id, r.attempted_at);
  } catch (e) {
    console.warn('[payment_flags] load error:', e?.message || e);
  }
}

async function flagPaymentAttempt(userId) {
  try {
    const ts = new Date().toISOString();
    await supabase
      .from('payment_flags')
      .upsert({ user_id: userId, attempted_at: ts }, { onConflict: 'user_id' });
    PAYMENT_FLAGS.set(userId, ts);
  } catch (e) {
    console.warn('[payment_flags] upsert mislukt:', e?.message || e);
  }
}

/* ---------------------------
 * Acties
 * --------------------------- */
window.pbPayto = (userId, name, amount) => {
  if (!GLOBAL_PAYLINK) return toast('⚠️ Geen open betaallink ingesteld');

  flagPaymentAttempt(userId)
    .finally(async () => {
      await loadPaymentFlags();
      await renderOpenBalances();
      try { window.location.href = GLOBAL_PAYLINK; }
      catch { toast('⚠️ Kon betaallink niet openen'); }
    });
};

window.pbMarkPaid = async (userId) => {
  const balances = await computeOpenBalances('');
  const entry = balances.find((b) => b.id === userId);
  const amount = entry?.amount || 0;
  if (!(amount > 0)) return toast('Geen openstaand saldo');

  const { error: pErr } = await supabase
    .from('payments')
    .insert([{ user_id: userId, amount }]);
  if (pErr) return toast('❌ Betaling registreren mislukt');

  const { error: dErr } = await supabase.from('drinks').delete().eq('user_id', userId);
  if (dErr) return toast('⚠️ Betaling opgeslagen, maar drankjes niet gewist');

  // vlag wissen
  try { await supabase.from('payment_flags').delete().eq('user_id', userId); } catch {}

  toast(`✅ Betaald: ${euro(amount)}`);
  await loadPaymentFlags();
  await renderOpenBalances();
};
