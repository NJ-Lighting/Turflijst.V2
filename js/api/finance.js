// /js/api/finance.js // type: module
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserBalances } from './metrics.js';

// === Users fill ===
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

// === Open balances (payment page) ===
export async function loadOpenBalances(tableSel, searchSel) {
  const rows = await fetchUserBalances(supabase); // [{id,name,balance}]
  const q = (searchSel && $(searchSel)?.value?.trim().toLowerCase()) || '';
  const list = rows.filter(r => !q || r.name.toLowerCase().includes(q));

  const html = list.map(r => `
    <tr>
      <td>${esc(r.name)}</td>
      <td class="right">${euro(r.balance)}</td>
      <td style="text-align:center">
        <button class="btn" onclick="uiSendForUser('${esc(r.id)}','${esc(r.name)}')">Verstuur verzoek</button>
      </td>
    </tr>
  `).join('');

  if ($(tableSel)) $(tableSel).innerHTML = html || `<tr><td colspan="3">Geen openstaande saldi</td></tr>`;

  // helper
  if (typeof window !== 'undefined') {
    window.uiSendForUser = async (userId, userName) => {
      const amountStr = prompt(`Bedrag voor ${userName}? (bijv. 5,00)`, '');
      if (amountStr === null) return;
      const amt = Number(String(amountStr).replace(',', '.'));
      if (!Number.isFinite(amt) || amt <= 0) return toast('⚠️ Ongeldig bedrag');
      await sendPaymentRequest(userId, amt, { method: 'Tikkie' });
      toast('✉️ Betaalverzoek verstuurd');
      await loadOpenBalances(tableSel, searchSel);
      await loadPayments({ listAllSel: '#p-rows', listSentSel: '#p-sent-rows', listConfirmedSel: '#p-confirmed-rows', filterUserSel: '#p-filter-user' });
    };
  }

  if (searchSel && $(searchSel) && !$(searchSel).__bound) {
    $(searchSel).__bound = true;
    $(searchSel).addEventListener('input', () => loadOpenBalances(tableSel, searchSel));
  }
}

// === Payments listing ===
export async function loadPayments({ listAllSel, listSentSel, listConfirmedSel, filterUserSel } = {}) {
  const userId = filterUserSel && $(filterUserSel)?.value || '';
  let q = supabase.from('payments')
    .select('id, user_id, users(name), amount, method, note, status, request_sent_at, confirmed_at, created_at')
    .order('created_at', { ascending: false });
  if (userId) q = q.eq('user_id', userId);

  const { data, error } = await q;
  if (error) { console.error('[loadPayments] error', error); return; }

  const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('nl-NL') : '—';

  const allRows = (data || []).map(p => rowPayment(p)).join('');
  if (listAllSel && $(listAllSel)) $(listAllSel).innerHTML = allRows || `Geen betalingen`;

  const sentRows = (data || [])
    .filter(p => p.status === 'sent')
    .map(p => rowPaymentSent(p)).join('');
  if (listSentSel && $(listSentSel)) $(listSentSel).innerHTML = sentRows || `Geen lopende betaalverzoeken`;

  const confRows = (data || [])
    .filter(p => p.status === 'confirmed')
    .map(p => rowPaymentConfirmed(p)).join('');
  if (listConfirmedSel && $(listConfirmedSel)) $(listConfirmedSel).innerHTML = confRows || `Nog geen bevestigde betalingen`;

  function rowPayment(p) {
    const name = p?.users?.name || 'Onbekend';
    const when = p.status === 'confirmed' ? fmtDT(p.confirmed_at)
      : p.status === 'sent' ? fmtDT(p.request_sent_at)
      : fmtDT(p.created_at);
    const statusLabel = p.status === 'confirmed' ? '✅ Betaald'
      : p.status === 'sent' ? '✉️ Verstuurd'
      : p.status === 'cancelled' ? '❌ Geannuleerd' : '— Nog niet verstuurd';

    return `
      <tr>
        <td>${esc(name)}</td>
        <td class="right">${euro(p.amount || 0)}</td>
        <td>${esc(p.method || '')}</td>
        <td>${esc(p.note || '')}</td>
        <td>${statusLabel}</td>
        <td>${when}</td>
        <td>
          ${p.status === 'sent'
            ? `<button class="btn" onclick="uiMarkPaid('${p.id}')">Markeer als betaald</button>
               <button class="btn btn-warn" onclick="uiCancel('${p.id}')">Annuleren</button>`
            : p.status === 'confirmed'
              ? `<button class="btn btn-warn" data-del-id="${p.id}">Verwijderen</button>`
              : `<button class="btn btn-warn" data-del-id="${p.id}">Verwijderen</button>`
          }
        </td>
      </tr>
    `;
  }

  function rowPaymentSent(p) {
    const name = p?.users?.name || 'Onbekend';
    return `
      <tr>
        <td>${esc(name)}</td>
        <td class="right">${euro(p.amount || 0)}</td>
        <td>${esc(p.method || '')}</td>
        <td>${esc(p.note || '')}</td>
        <td>✉️ Verstuurd op ${new Date(p.request_sent_at).toLocaleString('nl-NL')}</td>
        <td>—</td>
        <td>
          <button class="btn" onclick="uiMarkPaid('${p.id}')">Markeer als betaald</button>
          <button class="btn btn-warn" onclick="uiCancel('${p.id}')">Annuleren</button>
        </td>
      </tr>
    `;
  }

  function rowPaymentConfirmed(p) {
    const name = p?.users?.name || 'Onbekend';
    return `
      <tr>
        <td>${esc(name)}</td>
        <td class="right">${euro(p.amount || 0)}</td>
        <td>${esc(p.method || '')}</td>
        <td>${esc(p.note || '')}</td>
        <td>✅ Betaald</td>
        <td>${new Date(p.confirmed_at).toLocaleString('nl-NL')}</td>
        <td><button class="btn btn-warn" data-del-id="${p.id}">Verwijderen</button></td>
      </tr>
    `;
  }

  // kleine helpers op window
  if (typeof window !== 'undefined') {
    window.uiMarkPaid = async (id) => { await confirmPayment(id); await loadPayments({ listAllSel, listSentSel, listConfirmedSel, filterUserSel }); };
    window.uiCancel   = async (id) => { await cancelPayment(id); await loadPayments({ listAllSel, listSentSel, listConfirmedSel, filterUserSel }); };
  }
}

// === Payments actions ===
export async function sendPaymentRequest(userId, amount, { note = '', method = 'Tikkie' } = {}) {
  const { error } = await supabase.from('payments').insert([{
    user_id: userId, amount, method, note,
    status: 'sent', request_sent_at: new Date().toISOString()
  }]);
  if (error) throw error;
}

export async function confirmPayment(paymentId) {
  // 1) Haal payment + user op
  const { data: pRows, error: pErr } = await supabase
    .from('payments')
    .select('id, user_id, amount, status')
    .eq('id', paymentId)
    .maybeSingle();
  if (pErr) throw pErr;
  const p = pRows;
  if (!p) throw new Error('Payment niet gevonden');
  if (p.status === 'cancelled') throw new Error('Payment is geannuleerd');

  // 2) Openstaand totaal
  const { data: drinks, error: dErr } = await supabase
    .from('drinks')
    .select('id, price_at_purchase, paid')
    .eq('user_id', p.user_id)
    .or('paid.eq.false,paid.is.null');
  if (dErr) throw dErr;
  const openTotal = (drinks || []).reduce((s, r) => s + toNumber(r.price_at_purchase), 0);

  // 3) Zet onbetaalde drankjes op betaald
  if (openTotal > 0) {
    let { error: updErr } = await supabase
      .from('drinks')
      .update({ paid: true })
      .eq('user_id', p.user_id)
      .or('paid.eq.false,paid.is.null');
    if (updErr) throw updErr;
  }

  // 4) Payment op confirmed
  const confirmedAt = new Date().toISOString();
  const { error: cErr } = await supabase
    .from('payments')
    .update({ status: 'confirmed', confirmed_at: confirmedAt, amount: openTotal })
    .eq('id', p.id);
  if (cErr) throw cErr;
}

export async function cancelPayment(paymentId) {
  const { error } = await supabase
    .from('payments')
    .update({ status: 'cancelled' })
    .eq('id', paymentId);
  if (error) throw error;
}

export async function addDirectPayment(userId, amount, { note = '', method = 'contant' } = {}) {
  // Directe betaling → confirmed en drankjes afboeken
  const { data: drinks, error: dErr } = await supabase
    .from('drinks')
    .select('id, price_at_purchase, paid')
    .eq('user_id', userId)
    .or('paid.eq.false,paid.is.null');
  if (dErr) throw dErr;
  const openTotal = (drinks || []).reduce((s, r) => s + toNumber(r.price_at_purchase), 0);

  if (openTotal > 0) {
    let { error: updErr } = await supabase
      .from('drinks')
      .update({ paid: true })
      .eq('user_id', userId)
      .or('paid.eq.false,paid.is.null');
    if (updErr) throw updErr;
  }

  const { error } = await supabase.from('payments').insert([{
    user_id: userId, amount: openTotal || amount, method, note, status: 'confirmed',
    confirmed_at: new Date().toISOString()
  }]);
  if (error) throw error;
}

export async function deletePayment(paymentId) {
  const { error } = await supabase.from('payments').delete().eq('id', paymentId);
  if (error) throw error;
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// -------------------- NIEUW: finance.page.js dependencies --------------------
export async function addPayment(userSel, amountSel, noteSel, onDone) {
  const userId = userSel && $(userSel)?.value || '';
  const amountStr = amountSel && $(amountSel)?.value || '';
  const note = (noteSel && $(noteSel)?.value?.trim()) || '';
  const amount = Number(String(amountStr).replace(',', '.'));
  if (!userId) return toast('⚠️ Kies een gebruiker');
  if (!Number.isFinite(amount) || amount <= 0) return toast('⚠️ Ongeldig bedrag');
  await sendPaymentRequest(userId, amount, { note, method: 'Tikkie' });
  if (onDone) await onDone();
  if (amountSel && $(amountSel)) $(amountSel).value = '';
  if (noteSel && $(noteSel)) $(noteSel).value = '';
  toast('✉️ Betaalverzoek verstuurd');
}

export async function addDeposit(amountSel, noteSel, onDone) {
  const amountStr = amountSel && $(amountSel)?.value || '';
  const note = (noteSel && $(noteSel)?.value?.trim()) || '';
  const amount = Number(String(amountStr).replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return toast('⚠️ Ongeldig bedrag');

  const { error } = await supabase.from('deposits').insert([{
    amount, note, created_at: new Date().toISOString()
  }]);
  if (error) { console.error('[addDeposit] error', error); return toast('❌ Fout bij opslaan'); }

  if (amountSel && $(amountSel)) $(amountSel).value = '';
  if (noteSel && $(noteSel)) $(noteSel).value = '';
  if (onDone) await onDone();
  toast('♻️ Statiegeld geregistreerd');
}

export async function loadKPIs(containerSel = '#kpi-cards') {
  const el = $(containerSel); if (!el) return;

  const { data: dSum } = await supabase
    .from('drinks')
    .select('price_at_purchase', { count: 'exact', head: false });
  const soldCount = (dSum || []).length;
  const soldTotal = (dSum || []).reduce((s, r) => s + toNumber(r.price_at_purchase), 0);

  const { data: pRows } = await supabase
    .from('payments')
    .select('amount, status');
  const paidTotal = (pRows || [])
    .filter(p => p.status === 'confirmed')
    .reduce((s, p) => s + toNumber(p.amount), 0);

  const { data: depRows } = await supabase
    .from('deposits')
    .select('amount');
  const depositIn = (depRows || []).reduce((s, r) => s + toNumber(r.amount), 0);

  let bufferUsed = 0;
  try {
    const { data: bRows } = await supabase.from('stock_batches').select('buffer_used');
    bufferUsed = (bRows || []).reduce((s, r) => s + toNumber(r.buffer_used), 0);
  } catch {}
  const bufferAvail = Math.max(0, depositIn - bufferUsed);

  el.innerHTML = `
    <div class="card kpi"><div class="lbl">Verkocht (aantal)</div><div class="val">${esc(String(soldCount))}</div></div>
    <div class="card kpi"><div class="lbl">Omzet</div><div class="val">${euro(soldTotal)}</div></div>
    <div class="card kpi"><div class="lbl">Bevestigde betalingen</div><div class="val">${euro(paidTotal)}</div></div>
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
    .map(r => `<tr><td>${esc(r.name)}</td><td class="right">${euro(r.balance)}</td></tr>`)
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
  function ym(iso){ const d=new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  const sales = {}; const pays = {}; const deps = {};

  const { data: dRows } = await supabase.from('drinks').select('price_at_purchase, created_at');
  for (const r of (dRows||[])) { const k=ym(r.created_at); sales[k]=(sales[k]||0)+toNumber(r.price_at_purchase); }

  const { data: pRows } = await supabase.from('payments').select('amount, confirmed_at, status');
  for (const r of (pRows||[])) if (r.status==='confirmed' && r.confirmed_at) {
    const k=ym(r.confirmed_at); pays[k]=(pays[k]||0)+toNumber(r.amount);
  }

  const { data: depRows } = await supabase.from('deposits').select('amount, created_at');
  for (const r of (depRows||[])) { const k=ym(r.created_at); deps[k]=(deps[k]||0)+toNumber(r.amount); }

  const months = Array.from(new Set([...Object.keys(sales),...Object.keys(pays),...Object.keys(deps)])).sort();
  const rows = months.map(m => `
    <tr><td>${esc(m)}</td><td class="right">${euro(sales[m]||0)}</td><td class="right">${euro(pays[m]||0)}</td><td class="right">${euro(deps[m]||0)}</td></tr>
  `).join('');

  host.innerHTML = `
    <table class="table compact"><thead><tr>
      <th>Maand</th><th>Verkopen</th><th>Betalingen (confirmed)</th><th>Statiegeld</th>
    </tr></thead><tbody>${rows || `<tr><td colspan="4">—</td></tr>`}</tbody></table>
  `;
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
