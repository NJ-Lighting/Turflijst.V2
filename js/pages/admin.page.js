// /js/pages/admin.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserMetrics } from '../api/metrics.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  bindAdminEvents();
  $('#btn-add-product')?.addEventListener('click', addProduct);
});

/* ---------------------------
 * Event delegation (geen inline handlers)
 * --------------------------- */
function bindAdminEvents() {
  const usersTbody = $('#tbl-users');
  const prodsTbody = $('#tbl-products');

  if (usersTbody) {
    usersTbody.addEventListener('click', onUsersClick);
    usersTbody.addEventListener('change', onUsersChange);
  }
  if (prodsTbody) {
    prodsTbody.addEventListener('click', onProductsClick);
  }
}

function onUsersClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const tr = btn.closest('tr');
  const id = Number(tr?.dataset.userId);
  if (!id) return;

  if (btn.classList.contains('btn-edit-name')) return editNameFromRow(tr, id);
  if (btn.classList.contains('btn-zero'))     return zeroUser(id);
  if (btn.classList.contains('btn-paid'))     return markPaid(id);
  if (btn.classList.contains('btn-delete'))   return deleteUser(id);
}

function onUsersChange(e) {
  if (!e.target.classList.contains('wic-toggle')) return;
  const tr = e.target.closest('tr');
  const id = Number(tr?.dataset.userId);
  if (!id) return;
  updateUserWIC(id, e.target.checked);
}

function editNameFromRow(tr, id) {
  const current = tr.querySelector('.user-name')?.textContent?.trim() || '';
  const next = prompt('Nieuwe naam voor gebruiker:', current);
  if (!next) return;
  return updateUserName(id, next.trim());
}

function onProductsClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const tr = btn.closest('tr');
  const id = Number(tr?.dataset.prodId);
  if (!id) return;

  if (btn.classList.contains('btn-save-prod')) return saveProductFromRow(tr, id);
  if (btn.classList.contains('btn-del-prod'))  return deleteProduct(id);
}

function saveProductFromRow(tr, id) {
  const name  = tr.querySelector('.prod-name')?.value?.trim() || '';
  const price = parseFloat((tr.querySelector('.prod-price')?.value || '').replace(',', '.'));
  return saveProduct(id, name, price);
}

/* ---------------------------
 * Gebruikersbeheer
 * --------------------------- */
async function loadUsers() {
  try {
    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('id, name, phone, "WIcreations"')
      .order('name', { ascending: true });

    if (uErr) {
      console.error('users load error:', uErr);
      return toast('❌ Kan gebruikers niet laden');
    }

    let metrics = [];
    try { metrics = await fetchUserMetrics(supabase); } catch {}
    const metricById = new Map((metrics || []).map(m => [m.id, m]));

    const rows = (users || []).map(u => {
      const m = metricById.get(u.id) || {};
      const balance = typeof m.balance === 'number' ? m.balance : 0;
      const count   = typeof m.count   === 'number' ? m.count   : 0;

      return `
        <tr data-user-id="${u.id}">
          <td><span class="user-name">${esc(u.name)}</span> <button class="link btn-edit-name">✏️</button></td>
          <td>${esc(u.phone || '')}</td>
          <td><input class="wic-toggle" type="checkbox" ${u.WIcreations ? 'checked' : ''} /></td>
          <td class="right">${euro(balance)}</td>
          <td class="right">${count}</td>
          <td>
            <button class="btn-zero">Nulzetten</button>
            <button class="btn-paid">Betaald</button>
            <button class="btn-delete">🗑️ Verwijderen</button>
          </td>
        </tr>
      `;
    }).join('');

    $('#tbl-users').innerHTML = rows || '';
  } catch (err) {
    console.error('loadUsers error:', err);
    toast('❌ Kan gebruikers niet laden');
  }
}

async function updateUserName(id, newName) {
  if (!newName) return toast('⚠️ Ongeldige naam');
  const { error } = await supabase.from('users').update({ name: newName }).eq('id', id);
  if (error) { console.error('updateUserName error:', error); return toast('❌ Bijwerken mislukt'); }
  toast('✅ Naam bijgewerkt');
  await loadUsers();
}

async function updateUserWIC(id, checked) {
  const { error } = await supabase.from('users').update({ "WIcreations": !!checked }).eq('id', id);
  if (error) { console.error('updateUserWIC error:', error); return toast('❌ WIC opslaan mislukt'); }
  toast('✅ Opgeslagen');
}

async function zeroUser(id) {
  if (!confirm('Gebruiker resetten? (alle drankjes wissen)')) return;
  const { error } = await supabase.from('drinks').delete().eq('user_id', id);
  if (error) { console.error('zeroUser error:', error); return toast('❌ Reset mislukt'); }
  toast('✅ Gebruiker op 0 gezet');
  await loadUsers();
}

async function deleteUser(id) {
  if (!confirm('Weet je zeker dat je deze gebruiker wilt verwijderen?')) return;
  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) { console.error('deleteUser error:', error); return toast('❌ Verwijderen mislukt'); }
  toast('✅ Gebruiker verwijderd');
  await loadUsers();
}

async function markPaid(id) {
  const { data: drinks, error } = await supabase
    .from('drinks')
    .select('products(price)')
    .eq('user_id', id);
  if (error) { console.error('markPaid drinks error:', error); return toast('❌ Kan saldo niet bepalen'); }

  const total = (drinks || []).reduce((s, d) => s + (d.products?.price || 0), 0);
  if (!(total > 0)) return toast('Geen openstaand saldo');

  const extRef = `adminpay-${id}-${Date.now()}`;
  const { error: pErr } = await supabase
    .from('payments')
    .insert([{ user_id: id, amount: total, ext_ref: extRef }]);
  if (pErr) { console.error('payment insert error:', pErr); return toast('❌ Betaling registreren mislukt'); }

  const { error: dErr } = await supabase.from('drinks').delete().eq('user_id', id);
  if (dErr) { console.error('drinks delete after pay error:', dErr); return toast('⚠️ Betaling geregistreerd, maar drankjes niet gewist'); }

  toast(`✅ Betaling van ${euro(total)} geregistreerd`);
  await loadUsers();
}

/* ---------------------------
 * Productbeheer
 * --------------------------- */
async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price, image_url')
    .order('name', { ascending: true });

  if (error) { console.error('loadProducts error:', error); return toast('❌ Kon producten niet laden'); }

  function imgCell(p) {
    if (!p?.image_url) return '—';
    try {
      const { data } = supabase.storage.from('product-images').getPublicUrl(p.image_url);
      const url = data?.publicUrl || '#';
      return `<img src="${url}" alt="${esc(p.name)}" style="max-width:48px;max-height:48px;border-radius:6px" />`;
    } catch {
      return '—';
    }
  }

  const rows = (products || []).map(p => {
    const n = Number(p.price ?? 0);
    const valueAttr = Number.isFinite(n) ? n.toFixed(2) : '0.00';
    return `
      <tr data-prod-id="${p.id}">
        <td>${imgCell(p)}</td>
        <td><input class="input prod-name" value="${esc(p.name)}" /></td>
        <td><input class="input prod-price" type="number" step="0.01" inputmode="decimal" value="${valueAttr}" /></td>
        <td>
          <button class="btn-save-prod">Opslaan</button>
          <button class="btn-del-prod">🗑️ Verwijderen</button>
        </td>
      </tr>
    `;
  }).join('');

  $('#tbl-products').innerHTML = rows || '';
}

async function addProduct() {
  const name = $('#new-product-name')?.value?.trim();
  const price = parseFloat(($('#new-product-price')?.value || '').replace(',', '.'));
  const file = $('#new-product-image')?.files?.[0];

  if (!name) return toast('⚠️ Vul een productnaam in');
  if (!(price >= 0)) return toast('⚠️ Vul een geldige prijs in');

  let image_url = null;
  if (file) {
    const filename = `${Date.now()}_${file.name.replace(/\s+/g, '_').toLowerCase()}`;
    const { error: upErr } = await supabase.storage.from('product-images').upload(filename, file);
    if (upErr) { console.error('upload error:', upErr); return toast('❌ Upload mislukt'); }
    image_url = filename;
  }

  const { error } = await supabase.from('products').insert([{ name, price, image_url }]);
  if (error) { console.error('addProduct error:', error); return toast('❌ Product toevoegen mislukt'); }

  toast('✅ Product toegevoegd');
  if ($('#new-product-name'))  $('#new-product-name').value  = '';
  if ($('#new-product-price')) $('#new-product-price').value = '';
  if ($('#new-product-image')) $('#new-product-image').value = '';

  await loadProducts();
}

async function saveProduct(id, name, price) {
  if (!name)         return toast('⚠️ Naam is verplicht');
  if (!(price >= 0)) return toast('⚠️ Ongeldige prijs');

  const { error } = await supabase.from('products').update({ name, price }).eq('id', id);
  if (error) { console.error('saveProduct error:', error); return toast('❌ Bijwerken mislukt'); }

  toast('✅ Product opgeslagen');
  await loadProducts();
}

async function deleteProduct(id) {
  if (!confirm('Weet je zeker dat je dit product wilt verwijderen?')) return;

  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) { console.error('deleteProduct error:', error); return toast('❌ Verwijderen mislukt'); }

  toast('✅ Product verwijderd');
  await loadProducts();
}
