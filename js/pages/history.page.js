import { $, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadUserFilter();
    await loadHistory();
  } catch (e) {
    console.error(e);
    toast('❌ Kon geschiedenis niet laden');
  }
  $('#h-apply')?.addEventListener('click', loadHistory);
});

async function loadUserFilter(){
  const { data: users, error } = await supabase
    .from('users').select('id, name').order('name', { ascending: true });
  if (error) throw error;
  const sel = $('#h-user');
  if (!sel) return;
  sel.innerHTML = ['<option value="">— Alle gebruikers —</option>']
    .concat((users||[]).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`))
    .join('');
}

function isoStart(dateStr){
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return d.toISOString();
}
function isoEnd(dateStr){
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T23:59:59.999');
  return d.toISOString();
}

async function loadHistory(){
  const userId = $('#h-user')?.value || '';
  const from   = $('#h-from')?.value || '';
  const to     = $('#h-to')?.value   || '';

  // Drankjes
  let dq = supabase
    .from('drinks')
    .select('id, created_at, user_id, users(name), product_id, products(name), sell_price_at_purchase')
    .order('created_at', { ascending: true });
  if (userId) dq = dq.eq('user_id', userId);
  if (from)   dq = dq.gte('created_at', isoStart(from));
  if (to)     dq = dq.lte('created_at', isoEnd(to));
  const { data: drinks, error: dErr } = await dq;
  if (dErr) throw dErr;

  // Betalingen
  let pq = supabase
    .from('payments')
    .select('created_at, user_id, amount')
    .order('created_at', { ascending: true });
  if (userId) pq = pq.eq('user_id', userId);
  if (from)   pq = pq.gte('created_at', isoStart(from));
  if (to)     pq = pq.lte('created_at', isoEnd(to));
  const { data: pays, error: pErr } = await pq;
  if (pErr) throw pErr;

  // Merge & cumulatieven
  const evByUser = new Map();
  (drinks||[]).forEach(dr => {
    const uid = dr.user_id;
    if (!evByUser.has(uid)) evByUser.set(uid, []);
    evByUser.get(uid).push({
      type: 'drink',
      t: new Date(dr.created_at),
      user: dr.users?.name || '—',
      product: dr.products?.name || '—',
      amount: Number(dr.sell_price_at_purchase || 0),
    });
  });
  (pays||[]).forEach(py => {
    const uid = py.user_id;
    if (!evByUser.has(uid)) evByUser.set(uid, []);
    evByUser.get(uid).push({
      type: 'pay',
      t: new Date(py.created_at),
      amount: Number(py.amount || 0),
    });
  });

  const rows = [];
  let sum = 0;
  for (const [, evs] of evByUser.entries()) {
    evs.sort((a,b)=> a.t - b.t);
    let cumPaid = 0, cumCost = 0, lastUser = '';
    for (const ev of evs) {
      if (ev.type === 'pay') { cumPaid += ev.amount; continue; }
      cumCost += ev.amount; sum += ev.amount; lastUser = ev.user || lastUser;
      const paidNow = (cumPaid >= cumCost);
      rows.push(`
        <tr>
          <td>${esc(formatDate(ev.t.toISOString()))}</td>
          <td>${esc(lastUser)}</td>
          <td>${esc(ev.product)}</td>
          <td class="right">${euro(ev.amount)}</td>
          <td class="paid-cell ${paidNow ? 'paid-yes' : 'paid-no'}">${paidNow ? '✅' : '❌'}</td>
        </tr>
      `);
    }
  }
  $('#h-rows').innerHTML = rows.join('') || `<tr><td colspan="5" class="muted">Geen data</td></tr>`;
  $('#h-sum').textContent = euro(sum);
}
