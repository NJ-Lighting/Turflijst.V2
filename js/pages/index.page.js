import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserMetrics, fetchUserDrinkPivot } from '../api/metrics.js';

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

  grid.innerHTML = (products || []).map(p => `
    <div>
      <button class="btn drink-btn" type="button" onclick="logDrink(${p.id})">
        <div>${esc(p.name)}</div>
        <div>${euro(p.price)}</div>
      </button>
    </div>
  `).join('');
}

window.logDrink = async (productId) => {
  const userId = $('#user').value;
  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  // Drink registreren
  await supabase.from('drinks').insert([{ user_id: userId, product_id: productId }]);

  toast('✅ Drankje toegevoegd');
  await renderTotalsFromMetrics();
  await renderPivotFromMetrics();
};

window.undoLastDrink = async () => {
  const userId = $('#user').value;
  if (!userId) return toast('⚠️ Kies eerst een gebruiker');

  const { data, error } = await supabase
    .from('drinks')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return toast('❌ Geen drankje om te verwijderen');

  await supabase.from('drinks').delete().eq('id', data.id);

  toast('⏪ Laatste drankje verwijderd');
  await renderTotalsFromMetrics();
  await renderPivotFromMetrics();
};

async function renderTotalsFromMetrics(){
  const metrics = await fetchUserMetrics(supabase);
  $('#totalToPayList').innerHTML = (metrics || []).map(m => `
    <tr><td>${esc(m.name)}</td><td class="right">${euro(m.balance)}</td></tr>
  `).join('') || `<tr><td colspan="2" style="opacity:.7">Nog geen data</td></tr>`;
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
