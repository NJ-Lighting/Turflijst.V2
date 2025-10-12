// /js/pages/admin.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserMetrics } from '../api/metrics.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();
  $('#btn-add-product')?.addEventListener('click', addProduct);
});

async function loadUsers() {
  try {
    const { data: users, error: uErr } = await supabase
      .from('users')
      .select('id, name, phone, "WIcreations"')
      .order('name', { ascending: true });
    if (uErr) { console.error('users load error:', uErr); return toast('❌ Kan gebruikers niet laden'); }

    // Primair via metrics (total = som onbetaald met historische prijs)
    const balances = new Map();
    try {
      const metrics = await fetchUserMetrics(supabase); // [{id, total, ...}]
      for (const m of (metrics || [])) balances.set(m.id, Number(m.total || 0));
    } catch {}

    // Fallback: directe som price_at_purchase van onbetaald (paid=false/NULL)
    if (!balances.size) {
      const { data: drinks } = await supabase
        .from('drinks')
        .select('user_id, price_at_purchase, paid')
        .or('paid.eq.false,paid.is.null');
      const tmp = {};
      for (const d of (drinks || [])) {
        const uid = d.user_id; // UUID string
        const price = Number(d?.price_at_purchase) || 0;
        tmp[uid] = (tmp[uid] || 0) + price;
      }
      for (const uid of Object.keys(tmp)) balances.set(uid, tmp[uid]);
    }

    const rows = (users || []).map(u => {
      const due = balances.get(u.id) || 0;
      return `
        <tr>
          <td><input id="name_${u.id}" class="input" value="${esc(u.name)}" /></td>
          <td><input id="phone_${u.id}" class="input" value="${esc(u.phone || '')}" placeholder="06..." /></td>
          <td><input id="wic_${u.id}" type="checkbox" ${u.WIcreations ? 'checked' : ''} /></td>
          <td>€${Number.isFinite(due) ? due.toFixed(2) : '0.00'}</td>
          <td>
            <button class="btn" onclick="updateUser('${u.id}')">💾 Opslaan</button>
            <button class="btn" onclick="zeroUser('${u.id}')">🔄 Reset</button>
            <button class="btn" onclick="markAsPaid('${u.id}')">✅ Betaald</button>
            <button class="btn" onclick="deleteUser('${u.id}')">❌ Verwijderen</button>
          </td>
        </tr>
      `;
    }).join('');

    if ($('#tbl-users')) $('#tbl-users').innerHTML = rows;
    if ($('#userTable')) $('#userTable').innerHTML = rows;
  } catch (err) {
    console.error('loadUsers error:', err);
    toast('❌ Kan gebruikers niet laden');
  }
}

async function updateUser(userId) {
  const newName = $(`#name_${userId}`)?.value?.trim() || '';
  const newPhone = $(`#phone_${userId}`)?.value?.trim() || '';
  const wiChecked= $(`#wic_${userId}`)?.checked ? true : false;

  if (!newName) return toast('⚠️ Naam mag niet leeg zijn!');
  const payload = { name: newName, WIcreations: wiChecked };
  if (newPhone !== undefined) payload.phone = newPhone;

  const { error } = await supabase.from('users').update(payload).eq('id', userId);
  if (error) { console.error('updateUser error:', error); return toast('❌ Fout bij opslaan'); }
  toast('✅ Gegevens opgeslagen');
  await loadUsers();
}

async function zeroUser(userId) {
  if (!confirm('Weet je zeker dat je deze gebruiker wilt resetten?')) return;
  const { error } = await supabase.from('drinks').delete().eq('user_id', userId);
  if (error) { console.error('zeroUser error:', error); return toast('❌ Fout bij resetten'); }
  toast('✅ Gebruiker is gereset');
  await loadUsers();
}

async function markAsPaid(userId) {
  const { data: drinks, error } = await supabase
    .from('drinks')
    .select('id, price_at_purchase, paid')
    .eq('user_id', userId)
    .or('paid.eq.false,paid.is.null');

  if (error) {
    console.error('markAsPaid drinks error:', error);
    return toast('❌ Kan saldo niet bepalen');
  }

  const total = (drinks || []).reduce((sum, d) => sum + (Number(d?.price_at_purchase) || 0), 0);
  if (!(total > 0)) return toast('Geen onbetaalde items');

  const ids = (drinks || []).map(d => d.id);
  if (!ids.length) return toast('Geen onbetaalde items gevonden');

  // 1) markeer als betaald
  const { data: updRows, error: updErr } = await supabase
    .from('drinks')
    .update({ paid: true })
    .in('id', ids)
    .select('id, paid');
  if (updErr) {
    console.error('drinks update paid error:', updErr);
    return toast('❌ Kon drankjes niet markeren als betaald');
  }
  if (!((updRows || []).every(r => r?.paid === true))) {
    console.warn('[markAsPaid] Niet alle regels staan op paid=true', updRows);
  }

  // 2) payment-log (zonder ext_ref)
  const { error: payErr } = await supabase
    .from('payments')
    .insert([{ user_id: userId, amount: total }]);
  if (payErr) {
    console.error('payment insert error:', payErr);
    return toast('❌ Betaling registreren mislukt');
  }

  toast(`✅ Betaling van €${total.toFixed(2)} geregistreerd`);
  await loadUsers();
}

async function deleteUser(userId) {
  if (!confirm('Weet je zeker dat je dit product wilt verwijderen?')) return;
  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) { console.error('deleteUser error:', error); return toast('❌ Verwijderen mislukt'); }
  toast('✅ Gebruiker verwijderd');
  await loadUsers();
}

// Productbeheer
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
      return `<img src="${url}" alt="${esc(p.name)}" width="40" />`;
    } catch { return '—'; }
  }

  const rows = (products || []).map(p => {
    const v = Number.isFinite(Number(p.price)) ? Number(p.price).toFixed(2) : '0.00';
    return `
      <tr>
        <td>${imgCell(p)}</td>
        <td><input id="name_${p.id}" class="input" value="${esc(p.name)}" /></td>
        <td><input id="price_${p.id}" class="input" type="number" step="0.01" inputmode="decimal" value="${v}" /></td>
        <td>
          <button class="btn" onclick="updateProduct('${p.id}')">💾 Opslaan</button>
          <button class="btn" onclick="deleteProduct('${p.id}')">❌ Verwijderen</button>
        </td>
      </tr>
    `;
  }).join('');

  if ($('#tbl-products')) $('#tbl-products').innerHTML = rows;
  if ($('#productTable')) $('#productTable').innerHTML = rows;
}

async function addProduct() {
  const name  = $('#new-product-name')?.value?.trim() || $('#newProductName')?.value?.trim();
  const price = parseFloat((($('#new-product-price')?.value ?? $('#newProductPrice')?.value) || '').replace(',', '.'));
  const file  = ($('#new-product-image') || $('#productImage'))?.files?.[0];

  if (!name || !Number.isFinite(price)) return toast('⚠️ Ongeldige invoer');

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
  if ($('#newProductName'))    $('#newProductName').value    = '';
  if ($('#new-product-price')) $('#new-product-price').value = '';
  if ($('#newProductPrice'))   $('#newProductPrice').value   = '';
  if ($('#new-product-image')) $('#new-product-image').value = '';
  if ($('#productImage'))      $('#productImage').value      = '';

  await loadProducts();
}

async function updateProduct(productId) {
  const name  = $(`#name_${productId}`)?.value?.trim();
  const price = parseFloat(($(`#price_${productId}`)?.value || '').replace(',', '.'));
  if (!name) return toast('⚠️ Naam is verplicht');
  if (!Number.isFinite(price) || price < 0) return toast('⚠️ Ongeldige prijs');

  const { error } = await supabase.from('products').update({ name, price }).eq('id', productId);
  if (error) { console.error('updateProduct error:', error); return toast('❌ Bijwerken mislukt'); }
  toast('✅ Product opgeslagen');
  await loadProducts();
}

async function deleteProduct(productId) {
  if (!confirm('Weet je zeker dat je dit product wilt verwijderen?')) return;
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) { console.error('deleteProduct error:', error); return toast('❌ Verwijderen mislukt'); }
  toast('✅ Product verwijderd');
  await loadProducts();
}

/* Expose */
window.updateUser = updateUser;
window.zeroUser = zeroUser;
window.markAsPaid = markAsPaid;
window.deleteUser = deleteUser;
window.addProduct = addProduct;
window.updateProduct = updateProduct;
window.deleteProduct = deleteProduct;
