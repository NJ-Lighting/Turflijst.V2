// /js/pages/index.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#user')?.addEventListener('change', refreshTotals);
});

async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) return console.error(error);
  $('#user').innerHTML = (users || [])
    .map((u) => `<option value="${u.id}">${esc(u.name)}</option>`)
    .join('');
}

async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price')
    .order('name', { ascending: true });
  if (error) return console.error(error);
  const grid = $('#product-buttons');
  grid.innerHTML = (products || [])
    .map(
      (p) => `
        <button class="btn product" onclick="logDrink(${p.id})">
          ${esc(p.name)} – ${euro(p.price)}
        </button>`
    )
    .join('');
  await refreshTotals();
}

window.logDrink = async (productId) => {
  const userId = $('#user').value;
  if (!userId) return toast('⚠️ Kies eerst een gebruiker');
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
  const { data: users } = await supabase
    .from('users')
    .select('id, name, balance, total_drinks')
    .order('name', { ascending: true });
  $('#totalToPayList').innerHTML = (users || [])
    .map((u) => `<tr><td>${esc(u.name)}</td><td>${euro(u.balance || 0)}</td></tr>`)
    .join('');
  $('#userDrinkTotalsTable').innerHTML = (users || [])
    .map((u) => `<tr><td>${esc(u.name)}</td><td>${u.total_drinks || 0}</td></tr>`)
    .join('');
}
window.undoLastDrink = undoLastDrink;
