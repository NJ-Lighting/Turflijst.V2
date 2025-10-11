// === Turf Lijst – Index Pagina ===
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';

const fmtEUR = (n) => Number(n || 0).toFixed(2).replace('.', ',');

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#user')?.addEventListener('change', () => {
    loadTotalToPay();
    loadUserDrinkTotals();
  });
  await loadTotalToPay();
  await loadUserDrinkTotals();
});

/* ---------- Users ---------- */
async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) return console.error(error);

  const sel = $('#user');
  if (!sel) return;

  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = '-- Kies gebruiker --';
  sel.appendChild(ph);

  (users || []).forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.name;
    sel.appendChild(opt);
  });
}

/* ---------- Products ---------- */
async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price, image_url')
    .order('name', { ascending: true });

  if (error) return console.error(error);

  const grid = $('#product-buttons');
  if (!grid) return;

  grid.innerHTML = '';
  grid.classList.add('product-grid');

  (products || []).forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'btn drink-btn';
    btn.type = 'button';
    btn.addEventListener('click', () => logDrink(p.id));

    const imgUrl = p.image_url
      ? `https://stmpommlhkokcjkwivfc.supabase.co/storage/v1/object/public/product-images/${p.image_url}`
      : '';

    btn.innerHTML = `
      ${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(p.name)}" />` : ''}
      <div>
        <div>${esc(p.name)}</div>
        <div>€${fmtEUR(p.price)}</div>
      </div>
    `;

    const cell = document.createElement('div');
    cell.appendChild(btn);
    grid.appendChild(cell);
  });
}

/* ---------- Drinks actions ---------- */
async function logDrink(productId) {
  const userId = $('#user')?.value;
  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  // prijs ophalen voor eventuele balance-flows (compatibel met oude RPC)
  const { data: product } = await supabase
    .from('products')
    .select('price')
    .eq('id', productId)
    .single();

  const price = product?.price || 0;

  await supabase.from('drinks').insert([{ user_id: userId, product_id: productId }]);

  // Optioneel (indien je RPC gebruikt): await supabase.rpc('update_user_balance', { user_id: userId, amount: price });

  toast('✅ Drankje toegevoegd');
  await loadTotalToPay();
  await loadUserDrinkTotals();
}

async function undoLastDrink() {
  const userId = $('#user')?.value;
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

  // Optioneel (indien je RPC gebruikt):
  // const { data: prod } = await supabase.from('products').select('price').eq('id', data.product_id).single();
  // const price = prod?.price || 0;
  // await supabase.rpc('update_user_balance', { user_id: userId, amount: -price });

  toast('⏪ Laatste drankje verwijderd');
  await loadTotalToPay();
  await loadUserDrinkTotals();
}

// maak beschikbaar voor inline onclick in HTML
Object.assign(window, { logDrink, undoLastDrink });

/* ---------- Totals (tabel) ---------- */
async function loadTotalToPay() {
  // Als je users.balance gebruikt:
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, balance')
    .order('name', { ascending: true });

  if (error) return console.error(error);

  $('#totalToPayList').innerHTML =
    (users || [])
      .map(u => `
        <tr>
          <td>${esc(u.name)}</td>
          <td class="right">€${fmtEUR(u.balance || 0)}</td>
        </tr>
      `)
      .join('') || `<tr><td colspan="2" style="opacity:.7">Nog geen data</td></tr>`;
}

/* ---------- Pivot: Drankjes per gebruiker ---------- */
async function loadUserDrinkTotals() {
  const { data: rows, error } = await supabase
    .from('drinks')
    .select('user_id, users(name), products(name)');

  const headEl = document.getElementById('userDrinkTotalsHead');
  const bodyEl = document.getElementById('userDrinkTotalsBody');
  if (!headEl || !bodyEl) return;

  if (error) {
    console.error('loadUserDrinkTotals:', error);
    headEl.innerHTML = '';
    bodyEl.innerHTML = `<tr><td>Kon gegevens niet laden</td></tr>`;
    return;
  }

  const usersMap = new Map(); // userName -> Map(productName -> count)
  const productSet = new Set();

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
  const users    = Array.from(usersMap.keys()).sort(coll.compare);

  headEl.innerHTML = `
    <tr>
      <th>Gebruiker</th>
      ${products.map(p => `<th class="right">${esc(p)}</th>`).join('')}
    </tr>
  `;

  bodyEl.innerHTML = users.length
    ? users.map(u => {
        const m = usersMap.get(u);
        const tds = products.map(p => `<td class="right">${m.get(p) || 0}</td>`).join('');
        return `<tr><td>${esc(u)}</td>${tds}</tr>`;
      }).join('')
    : `<tr><td colspan="${1 + products.length}" style="opacity:.7">Nog geen data</td></tr>`;
}

// (optioneel) export voor tests
export { loadUsers, loadProducts, loadTotalToPay, loadUserDrinkTotals };
