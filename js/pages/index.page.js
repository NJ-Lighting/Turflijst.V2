// /js/pages/index.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserDrinkPivot, fetchUserTotalsCurrentPrice } from '../api/metrics.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#user')?.addEventListener('change', refreshTotals);
  await refreshTotals();
});

async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, "WIcreations"');
  if (error) return console.error(error);

  const sel = $('#user');
  const coll = new Intl.Collator('nl', { sensitivity:'base' });
  const sorted = (users || []).slice().sort((a,b) => {
    if (!!a.WIcreations !== !!b.WIcreations) return a.WIcreations ? -1 : 1;
    return coll.compare(a.name, b.name);
  });

  let html = `<option value="">-- Kies gebruiker --</option>`;
  let split = false;
  sorted.forEach(u => {
    if (!u.WIcreations && !split) { html += `<option disabled>────────────</option>`; split = true; }
    html += `<option value="${esc(u.id)}">${esc(u.name)}</option>`;
  });
  sel.innerHTML = html;
}

async function loadProducts() {
  // Producten
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price, image_url')
    .order('name', { ascending: true });
  if (error) return console.error(error);

  // Actieve voorraad
  const { data: batches, error: stockErr } = await supabase
    .from('stock_batches')
    .select('product_id, quantity')
    .gt('quantity', 0);
  if (stockErr) return console.error(stockErr);
  const stockMap = new Map();
  (batches || []).forEach(b => {
    const q = Number(b.quantity) || 0;
    stockMap.set(b.product_id, (stockMap.get(b.product_id) || 0) + q);
  });

  const grid = $('#product-buttons');
  if (!grid) return;
  grid.classList.add('product-grid');
  grid.innerHTML = '';
  const BUCKET_URL = 'https://stmpommlhkokcjkwivfc.supabase.co/storage/v1/object/public/product-images/';

  (products || [])
    .filter(p => (stockMap.get(p.id) || 0) > 0)
    .forEach(p => {
      const wrap = document.createElement('div');
      const btn  = document.createElement('button');
      btn.className = 'btn drink-btn';
      btn.type = 'button';
      const img = p.image_url ? `<img src="${BUCKET_URL + esc(p.image_url)}" alt="${esc(p.name)}">` : '';
      btn.innerHTML = `${img}<div><div>${esc(p.name)}</div><div>${euro(p.price)}</div></div>`;
      btn.addEventListener('click', () => logDrink(p.id));
      wrap.appendChild(btn);
      grid.appendChild(wrap);
    });
}

window.logDrink = async (productId) => {
  const userId = $('#user').value;
  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  const { data: product } = await supabase.from('products').select('price').eq('id', productId).single();
  const price = product?.price || 0;

  await supabase.from('drinks').insert([{ user_id: userId, product_id: productId }]);
  // balance bijwerken mag falen zonder UI te breken
  await supabase.rpc('update_user_balance', { user_id: userId, amount: price }).catch(() => {});
  toast('✅ Drankje toegevoegd');
  await refreshTotals();
};

window.undoLastDrink = async () => {
  const userId = $('#user').value;
  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  const { data, error } = await supabase
    .from('drinks')
    .select('id, product_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return toast('❌ Geen drankje om te verwijderen');

  await supabase.from('drinks').delete().eq('id', data.id);

  const { data: prod } = await supabase.from('products').select('price').eq('id', data.product_id).single();
  const price = prod?.price || 0;

  await supabase.rpc('update_user_balance', { user_id: userId, amount: -price }).catch(() => {});
  toast('⏪ Laatste drankje verwijderd');
  await refreshTotals();
};

async function refreshTotals() {
  // V1-conform totaal (géén payments), via metrics; geen 400 meer
  $('#totalToPayList').innerHTML = `<tr><td colspan="2">Laden…</td></tr>`;
  const rows = await fetchUserTotalsCurrentPrice(supabase);
  $('#totalToPayList').innerHTML =
    (rows || []).map(r => `<tr><td>${esc(r.name)}</td><td class="right">${euro(r.amount)}</td></tr>`).join('') ||
    `<tr><td colspan="2" style="opacity:.7">Nog geen data</td></tr>`;

  await renderUserDrinkPivot();
}

async function renderUserDrinkPivot() {
  // Gebruik metrics helper voor pivot (optioneel: rechtstreeks zoals v1)
  const { products, rows } = await fetchUserDrinkPivot(supabase);

  $('#userDrinkTotalsHead').innerHTML =
    `<tr><th>Gebruiker</th>${products.map(p => `<th class="right">${esc(p)}</th>`).join('')}</tr>`;

  $('#userDrinkTotalsBody').innerHTML =
    (rows || []).map(r =>
      `<tr><td>${esc(r.user)}</td>${r.counts.map(c => `<td class="right">${c}</td>`).join('')}</tr>`
    ).join('') ||
    `<tr><td colspan="${1 + products.length}" style="opacity:.7">Nog geen data</td></tr>`;
}
