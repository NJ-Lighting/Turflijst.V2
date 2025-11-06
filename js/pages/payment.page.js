// /js/pages/payment.page.js
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

let GLOBAL_PAYLINK = null;     // string | null
let GLOBAL_UPDATED_AT = null;  // timestamptz | null

document.addEventListener('DOMContentLoaded', async () => {
  await loadGlobalPayLink();   // laad globale open betaallink (payment_links)
  await renderOpenBalances();  // render saldi & infobalk

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

      return `
        <tr>
          <td>${name}</td>
          <td>${count}</td>
          <td>${amount}</td>
          <td>
            <button class="btn btn-small"
              onclick="pbPayto('${uid}','${name}', ${amountNum.toFixed(2)})">Betalen</button>
            ${ADMIN_MODE ? `<button class="btn btn-small" onclick="pbMarkPaid('${uid}')">✅ Betaald</button>` : ''}
          </td>
        </tr>`;
    })
    .join('');

  if ($('#pb-rows'))
    $('#pb-rows').innerHTML = rowsHtml || '<tr><td colspan="4">Geen resultaten</td></tr>';

  // Infobalk boven de tabel (alleen admin)
  const infoEl = document.getElementById('global-link-info');
  if (infoEl) {
    if (ADMIN_MODE && GLOBAL_PAYLINK) {
      const ts = GLOBAL_UPDATED_AT
        ? new Date(GLOBAL_UPDATED_AT).toLocaleString('nl-NL', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : 'onbekend tijdstip';
      infoEl.textContent = `🔗 Actieve betaallink ingesteld op ${ts}`;
      infoEl.style.display = 'block';
    } else {
      infoEl.style.display = 'none';
    }
  }
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

// Markeer als betaald
window.pbMarkPaid = async (userId) => {
  const balances = await computeOpenBalances('');
  const entry = balances.find((b) => b.id === userId);
  const amount = entry?.amount || 0;
  if (!(amount > 0)) return toast('Geen openstaand saldo');

  const { error: pErr } = await supabase
    .from('payments')
    .insert([{ user_id: userId, amount }]);
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
};

/* ---------------------------
 * Globale open betaallink (payment_links)
 * --------------------------- */
async function loadGlobalPayLink() {
  try {
    const { data, error } = await supabase
      .from('payment_links')
      .select('link, timestamp')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data?.link) {
      GLOBAL_PAYLINK = String(data.link);
      GLOBAL_UPDATED_AT = data.timestamp ?? null;
      return;
    }
  } catch (err) {
    console.warn('[global_paylink] tabel niet gevonden:', err?.message || err);
  }
  GLOBAL_PAYLINK = null;
  GLOBAL_UPDATED_AT = null;
}

window.pbSetGlobalPayLink = async () => {
  const current = GLOBAL_PAYLINK || '';
  const url = prompt('Voer de OPEN betaallink in (leeg = verwijderen):', current);
  if (url === null) return;

  try {
    if ((url || '').trim() === '') {
      await supabase.from('payment_links').delete().neq('id', null);
      GLOBAL_PAYLINK = null;
      GLOBAL_UPDATED_AT = null;
      toast(' Betaallink verwijderd');
    } else {
      const clean = url.trim();
      await supabase.from('payment_links').delete().neq('id', null);
      const { data, error } = await supabase
        .from('payment_links')
        .insert([{ link: clean }])
        .select('timestamp')
        .maybeSingle();
      if (error) throw error;

      GLOBAL_PAYLINK = clean;
      GLOBAL_UPDATED_AT = data?.timestamp ?? null;
      toast(' Betaallink opgeslagen');
    }
  } catch (e) {
    console.error(e);
    return toast('❌ Betaallink instellen mislukt');
  }

  const btn = document.getElementById('pb-set-global-link');
  if (btn) btn.textContent = GLOBAL_PAYLINK ? ' Betaallink wijzigen' : ' Betaallink instellen';

  // update infobalk direct
  renderOpenBalances();
};

// Betalen-knop: open de ingestelde link (ING: gewoon openen)
window.pbPayto = (userId, name, amount) => {
  if (!GLOBAL_PAYLINK) return toast('⚠️ Geen open betaallink ingesteld');
  try {
    window.location.href = GLOBAL_PAYLINK;
  } catch {
    toast('⚠️ Kon betaallink niet openen');
  }
};
