// /js/pages/index.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#user')?.addEventListener('change', refreshTotals);
  await refreshTotals();
});

async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) return console.error(error);

  $('#user').innerHTML = (users || [])
    .map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`)
    .join('');
}

async function loadProducts() {
  // 1) Producten laden
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price')
    .order('name', { ascending: true });
  if (error) return console.error(error);

  // 2) Actieve batches (quantity > 0) ophalen en optellen per product
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

  // 3) Alleen producten met voorraad > 0 renderen
  const grid = $('#product-buttons');
  grid.innerHTML = (products || [])
    .filter(p => (stockMap.get(p.id) || 0) > 0)
    .map(
      (p) => `
${esc(p.name)} – ${euro(p.price)}
`
    )
    .join('');
}

window.logDrink = async (productId) => {
  const userId = $('#user').value;
  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  // prijs ophalen (i.v.m. balance-update via RPC)
  const { data: product } = await supabase
    .from('products')
    .select('price')
    .eq('id', productId)
    .single();
  const price = product?.price || 0;

  await supabase.from('drinks').insert([{ user_id: userId, product_id: productId }]);
  await supabase.rpc('update_user_balance', { user_id: userId, amount: price });

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

  const { data: prod } = await supabase
    .from('products')
    .select('price')
    .eq('id', data.product_id)
    .single();
  const price = prod?.price || 0;

  await supabase.rpc('update_user_balance', { user_id: userId, amount: -price });

  toast('⏪ Laatste drankje verwijderd');
  await refreshTotals();
};

async function refreshTotals() {
  // Totaal te betalen (gebruikt users.balance)
  const { data: users } = await supabase
    .from('users')
    .select('id, name, balance')
    .order('name', { ascending: true });

  $('#totalToPayList').innerHTML = (users || [])
    .map((u) => `<tr><td>${esc(u.name)}</td><td class="right">${euro(u.balance || 0)}</td></tr>`)
    .join('');

  // Drankjes per gebruiker (pivot: 1 kolom per drankje)
  await renderUserDrinkPivot();
}

async function renderUserDrinkPivot() {
  const { data: rows, error } = await supabase
    .from('drinks')
    .select('user_id, users(name), products(name)');

  if (error) {
    console.error('renderUserDrinkPivot:', error);
    $('#userDrinkTotalsTable').innerHTML = `Kon gegevens niet laden`;
    return;
  }

  const usersMap = new Map(); // userName -> Map(productName -> count)
  const productSet = new Set(); // unieke productnamen

  for (const r of (rows || [])) {
    const user = r?.users?.name || 'Onbekend';
    const prod = r?.products?.name || 'Onbekend';
    productSet.add(prod);
    if (!usersMap.has(user)) usersMap.set(user, new Map());
    const m = usersMap.get(user);
    m.set(prod, (m.get(prod) || 0) + 1);
  }

  const coll = new Intl.Collator('nl', { sensitivity: 'base', numeric: true });
  const products = Array.from(productSet).sort(coll.compare);
  const users = Array.from(usersMap.keys()).sort(coll.compare);

  const headerRow = `<tr><th>Gebruiker</th>${products.map(p => `<th>${esc(p)}</th>`).join('')}</tr>`;
  const bodyRows = users.length
    ? users.map(u => {
        const m = usersMap.get(u);
        const tds = products.map(p => `<td>${m.get(p) || 0}</td>`).join('');
        return `<tr><td>${esc(u)}</td>${tds}</tr>`;
      }).join('')
    : `<tr><td colspan="${1 + products.length}">Nog geen data</td></tr>`;

  // Legacy: header + body in #userDrinkTotalsTable (tbody)
  $('#userDrinkTotalsTable').innerHTML = headerRow + bodyRows;
}
