// /js/pages/index.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#user')?.addEventListener('change', refreshTotals);
});

/* ---------- Data loaders ---------- */
async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) {
    console.error('loadUsers error:', error);
    toast('❌ Kan gebruikers niet laden');
    return;
  }

  const sel = $('#user');
  sel.innerHTML = (users || [])
    .map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`)
    .join('');

  // Option: direct totals na laden
  await refreshTotals();
}

async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price')
    .order('name', { ascending: true });

  if (error) {
    console.error('loadProducts error:', error);
    toast('❌ Kan producten niet laden');
    return;
  }

  const grid = $('#product-buttons');
  grid.innerHTML = (products || [])
    .map(p => `
      <button class="drink-btn" onclick="logDrink(${Number(p.id)})">
        ${esc(p.name)} – ${euro(p.price)}
      </button>
    `).join('');

  await refreshTotals();
}

/* ---------- Acties ---------- */
window.logDrink = async (productId) => {
  const userSel = $('#user');
  const userId = userSel?.value;

  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  const { data: product } = await supabase
    .from('products')
    .select('price')
    .eq('id', productId)
    .single();

  const price = product?.price || 0;

  // Log drankje
  const { error: insErr } = await supabase
    .from('drinks')
    .insert([{ user_id: userId, product_id: productId }]);

  if (insErr) {
    console.error('logDrink insert error:', insErr);
    return toast('❌ Fout bij loggen van drankje');
  }

  // Update saldo via RPC
  const { error: rpcErr } = await supabase
    .rpc('update_user_balance', { user_id: userId, amount: price });

  if (rpcErr) {
    console.error('update_user_balance error:', rpcErr);
    // (We laten het drankje staan; alleen saldo update faalde)
  }

  toast('✅ Drankje toegevoegd');
  await refreshTotals();
};

window.undoLastDrink = async () => {
  const userSel = $('#user');
  const userId = userSel?.value;

  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  // Pak laatste drankje
  const { data, error } = await supabase
    .from('drinks')
    .select('id, product_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return toast('❌ Geen drankje om te verwijderen');

  // Verwijder drankje
  const { error: delErr } = await supabase
    .from('drinks')
    .delete()
    .eq('id', data.id);

  if (delErr) {
    console.error('undo delete error:', delErr);
    return toast('❌ Verwijderen mislukt');
  }

  // Corrigeer saldo
  const { data: prod } = await supabase
    .from('products')
    .select('price')
    .eq('id', data.product_id)
    .single();

  const price = prod?.price || 0;

  const { error: rpcErr } = await supabase
    .rpc('update_user_balance', { user_id: userId, amount: -price });

  if (rpcErr) console.error('update_user_balance error:', rpcErr);

  toast('⏪ Laatste drankje verwijderd');
  await refreshTotals();
};

/* ---------- Totals render ---------- */
async function refreshTotals() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, balance, total_drinks')
    .order('name', { ascending: true });

  if (error) {
    console.error('refreshTotals error:', error);
    return;
  }

  const totalsTbody = $('#totalToPayList');
  totalsTbody.innerHTML = (users || [])
    .map((u) => `<tr><td>${esc(u.name)}</td><td>${euro(u.balance || 0)}</td></tr>`)
    .join('');

  const drinksTbody = $('#userDrinkTotalsTable');
  drinksTbody.innerHTML = (users || [])
    .map((u) => `<tr><td>${esc(u.name)}</td><td>${u.total_drinks || 0}</td></tr>`)
    .join('');
}
