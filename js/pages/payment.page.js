// /js/pages/payment.page.js
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

let GLOBAL_PAYLINK = null;
let PAYMENT_FLAGS = new Map();
let ADMIN_MODE = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadGlobalPayLink();
  await loadPaymentFlags();
  await renderOpenBalances();
  $('#pb-search')?.addEventListener('input', renderOpenBalances);
  $('#pb-admin')?.addEventListener('click', toggleAdminMode);
});

/* ---------- Saldi berekenen ---------- */
async function computeOpenBalances(searchTerm = '') {
  const { data: users } = await supabase.from('users').select('id, name').order('name', { ascending: true });
  const { data: rows } = await supabase.from('drinks').select('user_id, price_at_purchase, products(price)');

  const sumByUser = new Map(),
        countByUser = new Map();

  (rows || []).forEach(r => {
    const price = Number(r?.price_at_purchase ?? r?.products?.price ?? 0);
    const uid = r.user_id;
    sumByUser.set(uid, (sumByUser.get(uid) || 0) + price);
    countByUser.set(uid, (countByUser.get(uid) || 0) + 1);
  });

  const q = (searchTerm || '').trim().toLowerCase();
  return (users || [])
    .map(u => ({
      id: u.id,
      name: u.name,
      amount: sumByUser.get(u.id) || 0,
      count: countByUser.get(u.id) || 0
    }))
    .filter(u => !q || String(u.name || '').toLowerCase().includes(q))
    .filter(u => u.amount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- Tabel renderen ---------- */
async function renderOpenBalances() {
  const search = $('#pb-search')?.value || '';
  let list = [];
  try {
    list = await computeOpenBalances(search);
  } catch (err) {
    console.error(err);
    return toast('❌ Kan openstaande saldi niet berekenen');
  }

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

  const rowsHtml = list.map(u => {
    const name = esc(u.name);
    const amountNum = Number(u.amount) || 0;
    const amount = euro(amountNum);
    const count = String(u.count);
    const attemptISO = PAYMENT_FLAGS.get(u.id) || null;
    const attemptText = attemptISO ? new Date(attemptISO).toLocaleString('nl-NL', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : null;
    const attemptCell = attemptISO ? ` ${attemptText}${ADMIN_MODE ? ' ️' : ''}` : '—';

    // ---- HIER: alleen de WhatsApp-betaalverzoek knop ----
    let actions = '';
    if (GLOBAL_PAYLINK) {
      const waText = encodeURIComponent(`Beste ${u.name}, je openstaande saldo is €${amountNum.toFixed(2)}. Betaallink: ${GLOBAL_PAYLINK}`);
      const waLink = `https://wa.me/?text=${waText}`;
      actions = `<button class="btn" onclick="window.open('${waLink}','_blank','noopener,noreferrer')">WhatsApp betaalverzoek</button>`;
    }

    return ` <tr>
      <td>${name}</td>
      <td>${count}</td>
      <td>${amount}</td>
      <td>${attemptCell}</td>
      <td>${actions}</td>
    </tr> `;
  }).join('');

  if ($('#pb-rows')) {
    $('#pb-rows').innerHTML = rowsHtml || 'Geen resultaten';
  }
}

/* ---------- Admin-modus ---------- */
function toggleAdminMode() {
  if (!ADMIN_MODE) {
    const pin = prompt('Voer admin-PIN in:');
    if (pin !== '2420') return toast('❌ Onjuiste PIN');
    ADMIN_MODE = true;
  } else {
    ADMIN_MODE = false;
  }
  renderOpenBalances();
}

/* ---------- Betaald ---------- */
window.pbMarkPaid = async (userId) => {
  const balances = await computeOpenBalances('');
  const entry = balances.find(b => b.id === userId);
  const amount = entry?.amount || 0;
  if (!(amount > 0)) return toast('Geen openstaand saldo');

  const { error: pErr } = await supabase.from('payments').insert([{ user_id: userId, amount }]);
  if (pErr) return toast('❌ Betaling registreren mislukt');

  const { error: dErr } = await supabase.from('drinks').delete().eq('user_id', userId);
  if (dErr) return toast('⚠️ Betaling opgeslagen, maar drankjes niet gewist');

  try {
    await supabase.from('payment_flags').delete().eq('user_id', userId);
  } catch {}

  toast(`✅ Betaald: ${euro(amount)}`);
  await loadPaymentFlags();
  await renderOpenBalances();
};

/* ---------- Betaallink beheer ---------- */
async function loadGlobalPayLink() {
  try {
    const { data } = await supabase.from('view_payment_link_latest').select('link,timestamp').maybeSingle();
    GLOBAL_PAYLINK = data?.link || null;
  } catch {
    GLOBAL_PAYLINK = null;
  }
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
      await supabase.from('payment_links').insert([{ link: clean }]);
      GLOBAL_PAYLINK = clean;
      toast(' Betaallink opgeslagen');
    }
  } catch {
    toast('❌ Betaallink instellen mislukt');
  }
  const btn = document.getElementById('pb-set-global-link');
  if (btn) btn.textContent = GLOBAL_PAYLINK ? ' Betaallink wijzigen' : ' Betaallink instellen';
};

/* ---------- Betalen ---------- */
window.pbPayto = async (btn, userId, name, amount) => {
  if (!GLOBAL_PAYLINK) return toast('⚠️ Geen open betaallink ingesteld');
  try { btn.disabled = true; btn.classList.add('is-busy'); } catch {}
  try {
    await flagPaymentAttempt(userId);
    await loadPaymentFlags();
    await renderOpenBalances();
    window.open(GLOBAL_PAYLINK, '_blank', 'noopener,noreferrer');
  } finally {
    setTimeout(() => {
      try { btn.disabled = false; btn.classList.remove('is-busy'); } catch {}
    }, 600);
  }
};

/* ---------- Flags ---------- */
async function flagPaymentAttempt(userId) {
  try {
    const ts = new Date().toISOString();
    await supabase.from('payment_flags').upsert({ user_id: userId, attempted_at: ts }, { onConflict: 'user_id' });
    PAYMENT_FLAGS.set(userId, ts);
  } catch (e) {
    console.warn('[payment_flags] upsert mislukt:', e?.message || e);
    toast('⚠️ Melden van betaling mislukt');
  }
}

async function loadPaymentFlags() {
  try {
    PAYMENT_FLAGS.clear();
    const { data } = await supabase.from('payment_flags').select('user_id, attempted_at');
    for (const r of (data || [])) PAYMENT_FLAGS.set(r.user_id, r.attempted_at);
  } catch (e) {
    console.warn('[payment_flags] select error:', e);
    toast('⚠️');
  }
}

/* ---------- Flag wissen ---------- */
window.pbClearFlag = async (userId) => {
  if (!ADMIN_MODE) return toast('❌ Alleen in admin-modus');
  try {
    const { error } = await supabase.from('payment_flags').delete().eq('user_id', userId);
    if (error) throw error;
    toast('️ Meldvlag verwijderd');
    await loadPaymentFlags();
    await renderOpenBalances();
  } catch (e) {
    console.error('[pbClearFlag]', e);
    toast('❌ Verwijderen mislukt');
  }
};
