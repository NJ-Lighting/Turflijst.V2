// /js/api/finance.js  (schema-safe: geen status/method/note velden nodig)
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserBalances } from './metrics.js';

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/* =========================
   Users dropdowns
========================= */
export async function loadUsersToSelects(filterSel, addSel) {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) throw error;

  const opts = (users || [])
    .map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`)
    .join('');

  if (filterSel && $(filterSel)) $(filterSel).innerHTML = `<option value="">— Alle —</option>${opts}`;
  if (addSel && $(addSel)) $(addSel).innerHTML = `<option value="">— Kies —</option>${opts}`;
}

/* =========================
   Open balances (payment page)
========================= */
export async function loadOpenBalances(tableSel, searchSel) {
  const rows = await fetchUserBalances(supabase);
  const q = (searchSel && $(searchSel)?.value?.trim().toLowerCase()) || '';
  const list = rows.filter(r => !q || r.name.toLowerCase().includes(q));

  const html = list.map(r => `
    <tr>
      <td>${esc(r.name)}</td>
      <td class="right">
        ${euro(
          r.openSinceLastPayment > 0
            ? r.balance - r.openSinceLastPayment
            : r.balance
        )}
      </td>
      <td style="text-align:center">
        <button class="btn"
          onclick="uiSendForUser('${esc(r.id)}','${esc(r.name)}')">
          Verstuur verzoek
        </button>
      </td>
    </tr>

    ${
      r.openSinceLastPayment > 0
        ? `
          <tr class="sub-row">
            <td colspan="3" style="font-size:0.9em; opacity:0.75; padding-left:24px">
              ↳ Nieuw sinds betaalpoging:
              <strong>${euro(r.openSinceLastPayment)}</strong>
            </td>
          </tr>
        `
        : ''
    }
  `).join('');

  if ($(tableSel)) {
    $(tableSel).innerHTML =
      html || `<tr><td colspan="3">Geen openstaande saldi</td></tr>`;
  }

  /* =========================
     Betaalpoging starten
     → payment_flags
  ========================= */
  if (typeof window !== 'undefined') {
    window.uiSendForUser = async (userId, userName) => {
      const amountStr = prompt(`Bedrag voor ${userName}? (bijv. 5,00)`, '');
      if (amountStr === null) return;

      const amount = Number(String(amountStr).replace(',', '.'));
      if (!Number.isFinite(amount) || amount <= 0) {
        return toast('⚠️ Ongeldig bedrag');
      }

      // ✅ FIX: gebruik upsert met onConflict=user_id (primary key/unique)
      const { error } = await supabase
        .from('payment_flags')
        .upsert(
          {
            user_id: userId,
            amount,
            attempted_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        );

      // ✅ FIX: maar 1 error-check (oude “er staat al een betaalpoging open” block weg)
      if (error) {
        console.error(error);
        return toast('⚠️ Kan betaalpoging niet opslaan');
      }

      toast('💸 Betaalpoging gestart');
      await loadOpenBalances(tableSel, searchSel);
    };
  }

  if (searchSel && $(searchSel) && !$(searchSel).__bound) {
    $(searchSel).__bound = true;
    $(searchSel).addEventListener('input', () =>
      loadOpenBalances(tableSel, searchSel)
    );
  }
}

/* =========================
   Payments listing (ongewijzigd)
========================= */
export async function loadPayments({ listAllSel, listSentSel, listConfirmedSel, filterUserSel } = {}) {
  const userId = filterUserSel && $(filterUserSel)?.value || '';
  let q = supabase.from('payments')
    .select('id, user_id, users(name), amount, created_at')
    .order('created_at', { ascending: false });
  if (userId) q = q.eq('user_id', userId);

  const { data, error } = await q;
  if (error) { console.error('[loadPayments] error', error); return; }

  const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('nl-NL') : '—';

  const rowsAll = (data || []).map(p => `
    <tr>
      <td>${esc(p?.users?.name || 'Onbekend')}</td>
      <td class="right">${euro(p.amount || 0)}</td>
      <td>${fmtDT(p.created_at)}</td>
      <td>
        <button class="btn btn-warn" data-del-id="${p.id}">Verwijderen</button>
      </td>
    </tr>
  `).join('');

  if (listAllSel && $(listAllSel)) $(listAllSel).innerHTML = rowsAll || `Geen betalingen`;

  if (listSentSel && $(listSentSel)) $(listSentSel).innerHTML = `—`;
  if (listConfirmedSel && $(listConfirmedSel)) $(listConfirmedSel).innerHTML = `—`;

  document.querySelectorAll('[data-del-id]').forEach(btn => {
    if (btn.__bind) return;
    btn.__bind = true;
    btn.addEventListener('click', async () => {
      await deletePayment(btn.getAttribute('data-del-id'));
      await loadPayments({ listAllSel, listSentSel, listConfirmedSel, filterUserSel });
    });
  });
}

/* =========================
   Betaling bevestigen
========================= */
export async function confirmPayment(userId) {
  // ✅ FIX: haal betaalpoging op i.p.v. upsert
  const { data: flag, error: fErr } = await supabase
    .from('payment_flags')
    .select('amount, attempted_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (fErr) {
    console.error(fErr);
    return toast('⚠️ Fout bij ophalen betaalpoging');
  }
  if (!flag) {
    return toast('⚠️ Geen betaalpoging gevonden');
  }

  // 🔧 drinks t/m attempted_at → paid
  const { error: updErr } = await supabase
    .from('drinks')
    .update({ paid: true })
    .eq('user_id', userId)
    .lte('created_at', flag.attempted_at);
  if (updErr) throw updErr;

  // 🔧 payment aanmaken met vast bedrag
  const { error: payErr } = await supabase
    .from('payments')
    .insert([{
      user_id: userId,
      amount: flag.amount
    }]);
  if (payErr) throw payErr;

  // 🔧 betaalpoging opruimen
  const { error: delErr } = await supabase
    .from('payment_flags')
    .delete()
    .eq('user_id', userId);

  if (delErr) {
    console.error(delErr);
    // niet blokkeren: betaling is al gelogd & drinks paid gezet
  }

  toast('✅ Betaling afgerond');
}

export async function deletePayment(paymentId) {
  const { error } = await supabase.from('payments').delete().eq('id', paymentId);
  if (error) throw error;
}

/* =========================
   ALLES HIERONDER: ONGEWIJZIGD
========================= */
export async function loadKPIs(containerSel = '#kpi-cards') {
  const el = $(containerSel); if (!el) return;

  // verkochte drankjes
  const { data: dSum } = await supabase
    .from('drinks')
    .select('price_at_purchase', { count: 'exact', head: false });
  const soldCount = (dSum || []).length;
  const soldTotal = (dSum || []).reduce((s, r) => s + toNumber(r.price_at_purchase), 0);

  // betalingen (totaal)
  const { data: pRows } = await supabase
    .from('payments')
    .select('amount');
  const paidTotal = (pRows || []).reduce((s, p) => s + toNumber(p.amount), 0);

  // statiegeld
  const { data: depRows } = await supabase
    .from('deposits')
    .select('amount');
  const depositIn = (depRows || []).reduce((s, r) => s + toNumber(r.amount), 0);

  // buffer gebruikt (optioneel aanwezig)
  let bufferUsed = 0;
  try {
    const { data: bRows } = await supabase.from('stock_batches').select('buffer_used');
    bufferUsed = (bRows || []).reduce((s, r) => s + toNumber(r.buffer_used), 0);
  } catch {}
  const bufferAvail = Math.max(0, depositIn - bufferUsed);

  el.innerHTML = `
    <div class="card kpi"><div class="lbl">Verkocht (aantal)</div><div class="val">${esc(String(soldCount))}</div></div>
    <div class="card kpi"><div class="lbl">Omzet</div><div class="val">${euro(soldTotal)}</div></div>
    <div class="card kpi"><div class="lbl">Betalingen (totaal)</div><div class="val">${euro(paidTotal)}</div></div>
    <div class="card kpi"><div class="lbl">Statiegeld buffer</div><div class="val">${euro(bufferAvail)}</div></div>
  `;
}

export async function loadSoldPerProduct(tableSel = '#tbl-sold-per-product') {
  const el = $(tableSel); if (!el) return;
  const { data, error } = await supabase
    .from('drinks')
    .select('product_id, products(name), price_at_purchase');
  if (error) { console.error('[loadSoldPerProduct]', error); el.innerHTML = '—'; return; }

  const map = new Map();
  for (const r of (data || [])) {
    const name = r?.products?.name || 'Onbekend';
    const cur = map.get(name) || { cnt: 0, sum: 0 };
    cur.cnt += 1;
    cur.sum += toNumber(r.price_at_purchase);
    map.set(name, cur);
  }
  const rows = [...map.entries()]
    .sort((a,b)=> a[0].localeCompare(b[0], 'nl'))
    .map(([name, v]) => `<tr><td>${esc(name)}</td><td class="right">${esc(String(v.cnt))}</td><td class="right">${euro(v.sum)}</td></tr>`)
    .join('');
  el.innerHTML = rows || `<tr><td colspan="3">Geen data</td></tr>`;
}

export async function loadOpenPerUser(tableSel = '#tbl-open-users') {
  const el = $(tableSel); if (!el) return;
  const rows = await fetchUserBalances(supabase); // [{id,name,balance}]
  const html = (rows || [])
    .sort((a,b)=> a.name.localeCompare(b.name,'nl'))
    .map(r => `<tr><td>${esc(r.name)}</td><td class="right">
  ${euro(
    Math.max(
      0,
      r.balance - r.openSinceLastPayment
    )
  )}
</td>
</tr>`)
    .join('');
  el.innerHTML = html || `<tr><td colspan="2">—</td></tr>`;
}

export async function loadAging(tableSel = '#tbl-aging') {
  const el = $(tableSel); if (!el) return;
  const { data, error } = await supabase
    .from('drinks')
    .select('created_at, price_at_purchase, paid');
  if (error) { console.error('[loadAging]', error); el.innerHTML = '—'; return; }

  const buckets = { '≤30d':0, '31–60d':0, '61–90d':0, '90d+':0 };
  const now = Date.now();
  for (const r of (data||[])) {
    if (r.paid) continue;
    const age = (now - new Date(r.created_at).getTime()) / (1000*60*60*24);
    const v = toNumber(r.price_at_purchase);
    if (age <= 30) buckets['≤30d'] += v;
    else if (age <= 60) buckets['31–60d'] += v;
    else if (age <= 90) buckets['61–90d'] += v;
    else buckets['90d+'] += v;
  }

  el.innerHTML = `
    <tr><td>≤ 30 dagen</td><td class="right">${euro(buckets['≤30d'])}</td></tr>
    <tr><td>31–60 dagen</td><td class="right">${euro(buckets['31–60d'])}</td></tr>
    <tr><td>61–90 dagen</td><td class="right">${euro(buckets['61–90d'])}</td></tr>
    <tr><td>90+ dagen</td><td class="right">${euro(buckets['90d+'])}</td></tr>
  `;
}

export async function loadMonthlyStats(containerSel = '#month-stats') {
  const host = $(containerSel); if (!host) return;
  const ym = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };

  // drinks → omzet per maand
  const { data: dRows } = await supabase.from('drinks').select('price_at_purchase, created_at');
  const sales = {};
  for (const r of (dRows||[])) { const k=ym(r.created_at); sales[k]=(sales[k]||0)+toNumber(r.price_at_purchase); }

  // payments → totaal betaald per maand (op created_at)
  const { data: pRows } = await supabase.from('payments').select('amount, created_at');
  const pays = {};
  for (const r of (pRows||[])) { const k=ym(r.created_at); pays[k]=(pays[k]||0)+toNumber(r.amount); }

  // deposits → ingelegd per maand
  const { data: depRows } = await supabase.from('deposits').select('amount, created_at');
  const deps = {};
  for (const r of (depRows||[])) { const k=ym(r.created_at); deps[k]=(deps[k]||0)+toNumber(r.amount); }

  const months = Array.from(new Set([...Object.keys(sales),...Object.keys(pays),...Object.keys(deps)])).sort();
  const rows = months.map(m => `
    <tr><td>${esc(m)}</td><td class="right">${euro(sales[m]||0)}</td><td class="right">${euro(pays[m]||0)}</td><td class="right">${euro(deps[m]||0)}</td></tr>
  `).join('');

  host.innerHTML = `
    <table class="table compact"><thead><tr>
      <th>Maand</th><th>Verkopen</th><th>Betalingen</th><th>Statiegeld</th>
    </tr></thead><tbody>${rows || `<tr><td colspan="4">—</td></tr>`}</tbody></table>
  `;
}

/* =========================
   Deposits
========================= */
export async function addDeposit(amountSel, noteSel, onDone) {
  const amountStr = amountSel && $(amountSel)?.value || '';
  const amount = Number(String(amountStr).replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return toast('⚠️ Ongeldig bedrag');

  const payload = { amount, created_at: new Date().toISOString() };
  const { error } = await supabase.from('deposits').insert([payload]);
  if (error) { console.error('[addDeposit] error', error); return toast('❌ Fout bij opslaan'); }

  if (amountSel && $(amountSel)) $(amountSel).value = '';
  if (noteSel && $(noteSel)) $(noteSel).value = '';
  if (onDone) await onDone();
  toast('♻️ Statiegeld geregistreerd');
}

export async function loadDepositMetrics(inSel='#kpi-dep-in', usedSel='#kpi-dep-used', availSel='#kpi-dep-avail') {
  const { data: depRows } = await supabase.from('deposits').select('amount');
  const inSum = (depRows||[]).reduce((s,r)=>s+toNumber(r.amount),0);
  let used=0;
  try {
    const { data: bRows } = await supabase.from('stock_batches').select('buffer_used');
    used = (bRows||[]).reduce((s,r)=>s+toNumber(r.buffer_used),0);
  } catch {}
  const avail = Math.max(0, inSum - used);
  if ($(inSel)) $(inSel).textContent = euro(inSum);
  if ($(usedSel)) $(usedSel).textContent = euro(used);
  if ($(availSel)) $(availSel).textContent = euro(avail);
}

/* =========================
   UI helpers voor finance.page.js
========================= */
export async function addPayment(userSel, amountSel, noteSel, onDone) {
  const userId = userSel && $(userSel)?.value || '';
  const amountStr = amountSel && $(amountSel)?.value || '';
  const amount = Number(String(amountStr).replace(',', '.'));
  if (!userId) return toast('⚠️ Kies een gebruiker');
  if (!Number.isFinite(amount) || amount <= 0) return toast('⚠️ Ongeldig bedrag');

  // In jouw schema: direct een payment aanmaken
  const { error } = await supabase.from('payments').insert([{ user_id: userId, amount }]);
  if (error) { console.error('[addPayment] error', error); return toast('❌ Fout bij opslaan'); }

  if (onDone) await onDone();
  if (amountSel && $(amountSel)) $(amountSel).value = '';
  if (noteSel && $(noteSel)) $(noteSel).value = '';
  toast('💸 Betaling geregistreerd');
}

export async function loadKPIsAndTables() {
  await loadKPIs('#kpi-cards');
  await loadSoldPerProduct('#tbl-sold-per-product');
  await loadOpenPerUser('#tbl-open-users');
  await loadAging('#tbl-aging');
  await loadMonthlyStats('#month-stats');
}
