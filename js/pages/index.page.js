// /js/pages/index.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserMetrics } from '../api/metrics.js';
import {
  fifoConsume,
  fifoUnconsume,
  getProductsWithStock,
  syncProductPriceFromOldestBatch,
} from '../api/stock.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#user')?.addEventListener('change', refreshTotals);

  // Delegation voor productknoppen
  $('#product-buttons')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-product-id]');
    if (!btn) return;
    logDrink(btn.getAttribute('data-product-id'));
  });
});

/* ---------- Data loaders ---------- */

async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, "WIcreations"')
    .order('name', { ascending: true });

  if (error) {
    console.error('loadUsers error:', error);
    return toast('❌ Kan gebruikers niet laden');
  }

  const wi   = (users || []).filter(u => !!u.WIcreations);
  const rest = (users || []).filter(u => !u.WIcreations);

  const sel = $('#user');
  sel.innerHTML = [
    ...wi.map(u => `<option value="${esc(u.id)}">${esc(u.name)} (WIcreations)</option>`),
    '<option value="" disabled>──────────</option>',
    ...rest.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`),
  ].join('');

  await refreshTotals();
}

async function loadProducts() {
  // Alleen producten tonen met voorraad > 0 (som van batches)
  const products = await getProductsWithStock(supabase); // [{id,name,price,stock}]
  const grid = $('#product-buttons');

  if (!products.length) {
    grid.innerHTML = '<p style="opacity:.8">Geen voorraad beschikbaar.</p>';
    return;
  }

  grid.innerHTML = products
    .filter(p => (p.stock || 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => `
      <button class="btn" data-product-id="${esc(p.id)}" title="Nog ${p.stock} op voorraad">
        ${esc(p.name)} – ${euro(p.price)}
      </button>
    `)
    .join('');

  await refreshTotals();
}

/* ---------- Acties ---------- */

async function logDrink(productId) {
  try {
    const userSel = $('#user');
    const userId = userSel?.value;
    if (!userId) return toast('⚠️ Kies eerst een gebruiker');

    // 1) Log drankje
    const { error: insErr } = await supabase
      .from('drinks')
      .insert([{ user_id: userId, product_id: productId }]);
    if (insErr) {
      console.error('logDrink insert error:', insErr);
      return toast('❌ Fout bij loggen van drankje');
    }

    // 2) FIFO voorraad aftrekken (1 stuk)
    const ok = await fifoConsume(productId, 1);
    if (!ok) toast('⚠️ Let op: voorraad lijkt op te zijn');

    // 3) Prijs sync vanaf oudste batch (FIFO)
    await syncProductPriceFromOldestBatch(productId);

    toast('✅ Drankje toegevoegd');
    await loadProducts();   // voorraad & prijzen kunnen gewijzigd zijn
    await refreshTotals();
  } catch (err) {
    console.error(err);
    toast('❌ Fout bij toevoegen');
  }
}
window.logDrink = logDrink;

async function undoLastDrink() {
  const userSel = $('#user');
  const userId = userSel?.value;
  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  const { data, error } = await supabase
    .from('drinks')
    .select('id, product_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return toast('❌ Geen drankje om te verwijderen');

  const { error: delErr } = await supabase
    .from('drinks')
    .delete()
    .eq('id', data.id);
  if (delErr) {
    console.error('undo delete error:', delErr);
    return toast('❌ Verwijderen mislukt');
  }

  // FIFO terugboeken (1 stuk) + prijs sync
  await fifoUnconsume(data.product_id, 1);
  await syncProductPriceFromOldestBatch(data.product_id);

  toast('⏪ Laatste drankje verwijderd');
  await loadProducts();
  await refreshTotals();
}
window.undoLastDrink = undoLastDrink;

/* ---------- Overzichten ---------- */

async function refreshTotals() {
  try {
    const metrics = await fetchUserMetrics(supabase);

    // Totaal te betalen (gebruik nu balance i.p.v. total)
    const totalsTbody = $('#totalToPayList');
    if (totalsTbody) {
      totalsTbody.innerHTML = (metrics || [])
        .map(u => `<tr><td>${esc(u.name)}</td><td style="text-align:right">${euro(u.balance || 0)}</td></tr>`)
        .join('');
    }

    // Drankjes per gebruiker (aantal)
    const drinksTbody = $('#userDrinkTotalsTable');
    if (drinksTbody) {
      drinksTbody.innerHTML = (metrics || [])
        .map(u => `<tr><td>${esc(u.name)}</td><td style="text-align:right">${esc(u.count || 0)}</td></tr>`)
        .join('');
    }
  } catch (err) {
    console.error('refreshTotals metrics error:', err);
    toast('❌ Kan totalen niet laden');
  }
}
