// /js/api/finance.js
// type: module
import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

// Vul 2 selects: filter (optioneel "Alle") en toevoegen (optioneel "Kies")
export async function loadUsersToSelects(filterSel, paySel) {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) {
    console.error('[finance] loadUsersToSelects error:', error);
    return toast('❌ Kon gebruikers niet laden');
  }
  const opts = (users || [])
    .map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`)
    .join('');
  if (filterSel && $(filterSel)) {
    $(filterSel).innerHTML = `<option value="">— Alle —</option>${opts}`;
  }
  if (paySel && $(paySel)) {
    $(paySel).innerHTML = `<option value="">— Kies —</option>${opts}`;
  }
}

// Tabel met betalingen; optioneel filter op user_id (via select)
export async function loadPayments(rowsSel, filterSel) {
  const userId = filterSel && $(filterSel)?.value || '';
  let q = supabase
    .from('payments')
    .select('id, user_id, users(name), amount, note, method, created_at')
    .order('created_at', { ascending: false });
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) {
    console.error('[finance] loadPayments error:', error);
    return toast('❌ Kon betalingen niet laden');
  }
  const fmt = (iso) => new Date(iso).toLocaleString('nl-NL');
  const rows = (data || []).map(p => `
    <tr>
      <td>${esc(p?.users?.name || '—')}</td>
      <td style="text-align:right">${euro(p.amount || 0)}</td>
      <td>${esc(p.method || '')}</td>
      <td>${esc(p.note || '')}</td>
      <td>${fmt(p.created_at)}</td>
      <td><button class="btn btn-danger" onclick="uiDeletePayment('${esc(p.id)}')">Verwijderen</button></td>
    </tr>
  `).join('');
  if ($(rowsSel)) {
    $(rowsSel).innerHTML = rows || `<tr><td colspan="6">Geen betalingen</td></tr>`;
  }
}

// Voeg betaling toe vanuit 3 velden (dropdown user, bedrag, notitie)
export async function addPayment(userSel, amountSel, noteSel, after) {
  const userId = $(userSel)?.value || '';
  const amountStr = ($(amountSel)?.value || '').replace(',', '.');
  const note = $(noteSel)?.value?.trim() || '';
  const method = $('#p-method')?.value || 'contant'; // optionele method-select
  const amount = Number(amountStr);
  if (!userId) return toast('⚠️ Kies een gebruiker');
  if (!Number.isFinite(amount) || amount <= 0) return toast('⚠️ Ongeldig bedrag');
  const { error } = await supabase.from('payments').insert([{
    user_id: userId,
    amount,
    note,
    method
  }]);
  if (error) {
    console.error('[finance] addPayment error:', error);
    return toast('❌ Betaling toevoegen mislukt');
  }
  toast('✅ Betaling toegevoegd');
  if ($(amountSel)) $(amountSel).value = '';
  if ($(noteSel)) $(noteSel).value = '';
  if (typeof after === 'function') after();
}

// Verwijder één betaling
export async function deletePayment(paymentId, after) {
  if (!paymentId) return;
  if (!confirm('Weet je zeker dat je deze betaling wilt verwijderen?')) return;
  const { error } = await supabase.from('payments').delete().eq('id', paymentId);
  if (error) {
    console.error('[finance] deletePayment error:', error);
    return toast('❌ Verwijderen mislukt');
  }
  toast('🗑️ Betaling verwijderd');
  if (typeof after === 'function') after();
}
