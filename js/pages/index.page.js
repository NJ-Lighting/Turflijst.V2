import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserDrinkPivot, fetchUserTotalsCurrentPrice } from '../api/metrics.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#user')?.addEventListener('change', () => {
    renderTotalsFromMetrics();
    renderPivotFromMetrics();
  });
  await renderTotalsFromMetrics();
  await renderPivotFromMetrics();
});

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

async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price')
    .order('name', { ascending: true });
  if (error) return console.error(error);

  const grid = $('#product-buttons');
  if (!grid) return;

  grid.classList.add('product-grid');
  grid.innerHTML = '';
  (products || []).forEach(p => {
    const wrap = document.createElement('div');
    const btn  = document.createElement('button');
    btn.className = 'btn drink-btn';
    btn.type = 'button';
    btn.innerHTML = `<div>${esc(p.name)}</div><div>${euro(p.price)}</div>`;
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
  await supabase.rpc('update_user_balance', { user_id: userId, amount: price }).catch(() => {});
  toast('✅ Drankje toegevoegd');
  await renderTotalsFromMetrics();
  await renderPivotFromMetrics();
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
  await renderTotalsFromMetrics();
  await renderPivotFromMetrics();
};

async function renderTotalsFromMetrics(){
  try{
    $('#totalToPayList').innerHTML = `<tr><td colspan="2">Laden…</td></tr>`;
    // V1-conform: som van alle drinks met HUIDIGE products(price), géén payments
    const rows = await fetchUserTotalsCurrentPrice(supabase);
    $('#totalToPayList').innerHTML =
      (rows || []).map(r => `<tr><td>${esc(r.name)}</td><td class="right">${euro(r.amount)}</td></tr>`).join('') ||
      `<tr><td colspan="2" style="opacity:.7">Nog geen data</td></tr>`;
  }catch(e){
    console.error('renderTotalsFromMetrics:', e);
    $('#totalToPayList').innerHTML = `<tr><td colspan="2">Kon bedragen niet laden</td></tr>`;
  }
}

async function renderPivotFromMetrics(){
  try{
    const { products, rows } = await fetchUserDrinkPivot(supabase);
    $('#userDrinkTotalsHead').innerHTML =
      `<tr><th>Gebruiker</th>${products.map(p => `<th class="right">${esc(p)}</th>`).join('')}</tr>`;
    $('#userDrinkTotalsBody').innerHTML =
      (rows || []).map(r => `<tr><td>${esc(r.user)}</td>${r.counts.map(c => `<td class="right">${c}</td>`).join('')}</tr>`).join('') ||
      `<tr><td colspan="${1 + products.length}" style="opacity:.7">Nog geen data</td></tr>`;
  } catch(e){
    console.error('renderPivotFromMetrics:', e);
    $('#userDrinkTotalsHead').innerHTML = '';
    $('#userDrinkTotalsBody').innerHTML = `<tr><td>Kon gegevens niet laden</td></tr>`;
  }
}
