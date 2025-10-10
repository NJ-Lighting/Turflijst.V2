// /js/pages/admin.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#btn-add-product')?.addEventListener('click', addProduct);
});

async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, balance, total_drinks')
    .order('name', { ascending: true });
  if (error) return console.error(error);
  const rows = (users || [])
    .map(
      (u) => `
      <tr>
        <td>${esc(u.name)}</td>
        <td>${euro(u.balance || 0)}</td>
        <td>${u.total_drinks || 0}</td>
        <td>
          <button class="btn" onclick="resetUser(${u.id})">🔄 Nulzetten</button>
          <button class="btn" onclick="deleteUser(${u.id})">🗑️ Verwijderen</button>
          <button class="btn" onclick="markPaid(${u.id})">💰 Betaald</button>
        </td>
      </tr>`
    )
    .join('');
  $('#tbl-users').innerHTML = rows;
}

async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price')
    .order('name', { ascending: true });
  if (error) return console.error(error);
  const rows = (products || [])
    .map(
      (p) => `
      <tr>
        <td>${esc(p.name)}</td>
        <td>${euro(p.price)}</td>
        <td>
          <button class="btn" onclick="editProduct(${p.id})">✏️ Bewerken</button>
          <button class="btn" onclick="deleteProduct(${p.id})">🗑️ Verwijderen</button>
        </td>
      </tr>`
    )
    .join('');
  $('#tbl-products').innerHTML = rows;
}

async function addProduct() {
  const name = $('#new-product-name').value.trim();
  const price = parseFloat($('#new-product-price').value.replace(',', '.'));
  if (!name) return toast('⚠️ Vul een productnaam in');
  if (!(price >= 0)) return toast('⚠️ Vul een geldige prijs in');
  const { error } = await supabase.from('products').insert([{ name, price }]);
  if (error) return console.error(error);
  toast('✅ Product toegevoegd');
  $('#new-product-name').value = '';
  $('#new-product-price').value = '';
  await loadProducts();
}

async function editProduct(id) {
  const newPrice = prompt('Nieuwe prijs (€):');
  if (!newPrice) return;
  const price = parseFloat(newPrice.replace(',', '.'));
  if (!(price >= 0)) return toast('⚠️ Ongeldige prijs');
  const { error } = await supabase.from('products').update({ price }).eq('id', id);
  if (error) return console.error(error);
  toast('✅ Prijs bijgewerkt');
  await loadProducts();
}

async function deleteProduct(id) {
  if (!confirm('Weet je zeker dat je dit product wilt verwijderen?')) return;
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) return console.error(error);
  toast('✅ Product verwijderd');
  await loadProducts();
}

async function resetUser(id) {
  if (!confirm('Gebruiker resetten (saldo en drankjes naar 0)?')) return;
  const { error } = await supabase
    .from('users')
    .update({ balance: 0, total_drinks: 0 })
    .eq('id', id);
  if (error) return console.error(error);
  toast('✅ Gebruiker gereset');
  await loadUsers();
}

async function deleteUser(id) {
  if (!confirm('Weet je zeker dat je deze gebruiker wilt verwijderen?')) return;
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) return console.error(error);
  toast('✅ Gebruiker verwijderd');
  await loadUsers();
}

async function markPaid(id) {
  const { data: u } = await supabase.from('users').select('balance').eq('id', id).single();
  const amount = u?.balance || 0;
  if (amount <= 0) return toast('Geen openstaand saldo');
  const extRef = `adminpay-${id}-${Date.now()}`;
  await supabase.from('payments').insert([{ user_id: id, amount, ext_ref: extRef }]);
  await supabase.from('users').update({ balance: 0 }).eq('id', id);
  toast('✅ Betaling geregistreerd');
  await loadUsers();
}

// Expose voor inline onclicks
window.resetUser = resetUser;
window.deleteUser = deleteUser;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.markPaid = markPaid;
