import { $, euro, formatDate, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadHistory();
  } catch (e) {
    console.error(e);
    toast('❌ Kon geschiedenis niet laden');
  }
});

async function loadHistory() {
  // 1) Alle drankjes (gebruik verkoopprijs voor “wat betaald moet worden”)
  const { data: drinks, error: dErr } = await supabase
    .from('drinks')
    .select('id, created_at, user_id, users(name), product_id, products(name), sell_price_at_purchase')
    .order('created_at', { ascending: true });
  if (dErr) throw dErr;

  // 2) Alle betalingen
  const { data: pays, error: pErr } = await supabase
    .from('payments')
    .select('created_at, user_id, amount')
    .order('created_at', { ascending: true });
  if (pErr) throw pErr;

  // 3) Bouw event-tijdlijn per gebruiker
  const eventsByUser = new Map(); // uid -> events
  (drinks || []).forEach(dr => {
    const uid = dr.user_id;
    if (!eventsByUser.has(uid)) eventsByUser.set(uid, []);
    eventsByUser.get(uid).push({
      type: 'drink',
      t: new Date(dr.created_at),
      user: dr.users?.name || '—',
      product: dr.products?.name || '—',
      amount: Number(dr.sell_price_at_purchase || 0),
      raw: dr,
    });
  });
  (pays || []).forEach(py => {
    const uid = py.user_id;
    if (!eventsByUser.has(uid)) eventsByUser.set(uid, []);
    eventsByUser.get(uid).push({
      type: 'pay',
      t: new Date(py.created_at),
      amount: Number(py.amount || 0),
    });
  });

  // 4) Cumulatief rekenen
  const rowsHtml = [];
  let sum = 0;
  for (const [, evs] of eventsByUser.entries()) {
    evs.sort((a, b) => a.t - b.t);
    let cumPaid = 0;
    let cumCost = 0;
    let lastUserName = '';

    for (const ev of evs) {
      if (ev.type === 'pay') {
        cumPaid += ev.amount;
        continue;
      }
      // drink
      cumCost += ev.amount;
      sum += ev.amount;
      lastUserName = ev.user || lastUserName;
      const paidNow = (cumPaid >= cumCost);

      rowsHtml.push(`
        <tr>
          <td>${esc(formatDate(ev.t.toISOString()))}</td>
          <td>${esc(lastUserName)}</td>
          <td>${esc(ev.product)}</td>
          <td class="right">${euro(ev.amount)}</td>
          <td class="paid-cell ${paidNow ? 'paid-yes' : 'paid-no'}">${paidNow ? '✅' : '❌'}</td>
        </tr>
      `);
    }
  }

  // 5) Render
  $('#h-rows').innerHTML = rowsHtml.join('') || `<tr><td colspan="5" class="muted">Geen data</td></tr>`;
  $('#h-sum').textContent = euro(sum);
}
