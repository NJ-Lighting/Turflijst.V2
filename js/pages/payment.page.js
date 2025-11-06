// /js/api/finance.js
// type: module
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserBalances } from './metrics.js';

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

export async function loadOpenBalances(tableSel, searchSel) {
  const rows = await fetchUserBalances(supabase); // [{id,name,balance}]
  const q = (searchSel && $(searchSel)?.value?.trim().toLowerCase()) || '';
  const list = rows.filter(r => !q || r.name.toLowerCase().includes(q));
  const html = list.map(r => `
    <tr>
      <td>${esc(r.name)}</td>
      <td style="text-align:right">${euro(r.balance)}</td>
      <td><button onclick="uiSendForUser('${esc(r.id)}','${esc(r.name)}')" class="btn">Verstuur verzoek</button></td>
    </tr>`).join('');
  if ($(tableSel)) $(tableSel).innerHTML = html || `<tr><td colspan="3">Geen openstaande saldi</td></tr>`;
  // snelle “verstuur verzoek”-helper per user
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

// UI list loader – toont 3 blokken: alle, lopende (sent), bevestigd
export async function loadPayments({ listAllSel, listSentSel, listConfirmedSel, filterUserSel }) {
  const userId = filterUserSel && $(filterUserSel)?.value || '';
  let q = supabase.from('payments').select('id, user_id, users(name), amount, method, note, status, request_sent_at, confirmed_at, created_at')
    .order('created_at', { ascending: false });
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) { console.error('[loadPayments] error', error); return; }
  const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('nl-NL') : '—';

  const allRows = (data || []).map(p => rowPayment(p)).join('');
  if (listAllSel && $(listAllSel)) $(listAllSel).innerHTML = allRows || `<tr><td colspan="6">Geen betalingen</td></tr>`;

  const sentRows = (data || []).filter(p => p.status === 'sent')
    .map(p => rowPaymentSent(p)).join('');
  if (listSentSel && $(listSentSel)) $(listSentSel).innerHTML = sentRows || `<tr><td colspan="6">Geen lopende betaalverzoeken</td></tr>`;

  const confRows = (data || []).filter(p => p.status === 'confirmed')
    .map(p => rowPaymentConfirmed(p)).join('');
  if (listConfirmedSel && $(listConfirmedSel)) $(listConfirmedSel).innerHTML = confRows || `<tr><td colspan="6">Nog geen bevestigde betalingen</td></tr>`;

  function rowPayment(p) {
    const name = p?.users?.name || 'Onbekend';
    const when = p.status === 'confirmed' ? fmtDT(p.confirmed_at) :
                 p.status === 'sent' ? fmtDT(p.request_sent_at) :
                 fmtDT(p.created_at);
    const statusLabel =
      p.status === 'confirmed' ? '✅ Betaald' :
      p.status === 'sent' ? '✉️ Verstuurd' :
      p.status === 'cancelled' ? '❌ Geannuleerd' :
      '🕓 Nog niet verstuurd';
    return `
      <tr>
        <td>${esc(name)}</td>
        <td style="text-align:right">${euro(p.amount || 0)}</td>
        <td>${esc(p.method || '')}</td>
        <td>${esc(p.note || '')}</td>
        <td>${statusLabel}</td>
        <td>${when}</td>
        <td>
          ${p.status === 'sent'
            ? `<button class="btn" onclick="uiConfirmPayment('${esc(p.id)}')">Markeer als betaald</button>
               <button class="btn btn-danger" onclick="uiCancelPayment('${esc(p.id)}')">Annuleren</button>`
            : p.status === 'confirmed'
              ? `<button class="btn btn-danger" onclick="uiDeletePayment('${esc(p.id)}')">Verwijderen</button>`
              : `<button class="btn btn-danger" onclick="uiDeletePayment('${esc(p.id)}')">Verwijderen</button>`
          }
        </td>
      </tr>`;
  }
  function rowPaymentSent(p) {
    const name = p?.users?.name || 'Onbekend';
    return `
      <tr>
        <td>${esc(name)}</td>
        <td style="text-align:right">${euro(p.amount || 0)}</td>
        <td>${esc(p.method || '')}</td>
        <td>${esc(p.note || '')}</td>
        <td>✉️ Verstuurd op ${new Date(p.request_sent_at).toLocaleString('nl-NL')}</td>
        <td>
          <button class="btn" onclick="uiConfirmPayment('${esc(p.id)}')">Markeer als betaald</button>
          <button class="btn btn-danger" onclick="uiCancelPayment('${esc(p.id)}')">Annuleren</button>
        </td>
      </tr>`;
  }
  function rowPaymentConfirmed(p) {
    const name = p?.users?.name || 'Onbekend';
    return `
      <tr>
        <td>${esc(name)}</td>
        <td style="text-align:right">${euro(p.amount || 0)}</td>
        <td>${esc(p.method || '')}</td>
        <td>${esc(p.note || '')}</td>
        <td>✅ Betaald op ${new Date(p.confirmed_at).toLocaleString('nl-NL')}</td>
        <td><button class="btn btn-danger" onclick="uiDeletePayment('${esc(p.id)}')">Verwijderen</button></td>
      </tr>`;
  }
}

export async function sendPaymentRequest(userId, amount, { note = '', method = 'Tikkie' } = {}) {
  const { error } = await supabase.from('payments').insert([{
    user_id: userId,
    amount,
    method,
    note,
    status: 'sent',
    request_sent_at: new Date().toISOString()
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

  // 2) Bereken openstaand voor deze user (som onbetaalde drinks)
  const { data: drinks, error: dErr } = await supabase
    .from('drinks')
    .select('id, price_at_purchase, paid')
    .eq('user_id', p.user_id)
    .or('paid.eq.false,paid.is.null');
  if (dErr) throw dErr;
  const openTotal = (drinks || []).reduce((s, r) => s + toNumber(r.price_at_purchase), 0);

  // 3) Zet alle onbetaalde drankjes op betaald (zoals jouw huidige flow)
  if (openTotal > 0) {
    // 3a: snelle update
    let { error: updErr } = await supabase
      .from('drinks')
      .update({ paid: true })
      .eq('user_id', p.user_id)
      .or('paid.eq.false,paid.is.null');
    if (updErr) throw updErr;
  }

  // 4) Payment op confirmed + timestamp
  const confirmedAt = new Date().toISOString();
  // We zetten amount = openTotal zodat administratie klopt met afboeking.
  const { error: cErr } = await supabase
    .from('payments')
    .update({
      status: 'confirmed',
      confirmed_at: confirmedAt,
      amount: openTotal
    })
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
  // Directe betaling → meteen confirmed en drankjes afboeken
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
    user_id: userId,
    amount: openTotal || amount,
    method,
    note,
    status: 'confirmed',
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