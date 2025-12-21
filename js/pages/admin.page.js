// /js/pages/admin.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserMetrics } from '../api/metrics.js';
import { requirePin } from '../pin.js';

/* ---------------------------------------------------------
   INIT (PIN GATE)
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  if (!requirePin()) return;

  await loadUsers();
  await loadProducts();
  $('#btn-add-product')?.addEventListener('click', addProduct);
});

/* ---------- Gebruikersbeheer ---------- */
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

    const balances = new Map();

    try {
      const metrics = await fetchUserMetrics(supabase);
      for (const m of (metrics || [])) {
        balances.set(m.id, Number(m.total || 0));
      }
    } catch {}

    if (!balances.size) {
      const { data: drinks } = await supabase
        .from('drinks')
        .select('user_id, price_at_purchase, paid')
        .or('paid.eq.false,paid.is.null');

      for (const d of (drinks || [])) {
        balances.set(
          d.user_id,
          (balances.get(d.user_id) || 0) + Number(d.price_at_purchase || 0)
        );
      }
    }

    const rows = (users || []).map(u => `
      <tr>
        <td><input id="name_${u.id}" class="input" value="${esc(u.name)}" /></td>
        <td><input id="phone_${u.id}" class="input" value="${esc(u.phone || '')}" /></td>
        <td><input id="wic_${u.id}" type="checkbox" ${u.WIcreations ? 'checked' : ''} /></td>
        <td>€${(balances.get(u.id) || 0).toFixed(2)}</td>
        <td>
          <button class="btn" onclick="updateUser('${u.id}')">💾 Opslaan</button>
          <button class="btn" onclick="zeroUser('${u.id}')">🔄 Reset</button>
          <button class="btn" onclick="markAsPaid('${u.id}')">✅ Betaald</button>
          <button class="btn" onclick="deleteUser('${u.id}')">❌ Verwijderen</button>
        </td>
      </tr>
    `).join('');

    $('#tbl-users').innerHTML = rows;
  } catch (err) {
    console.error('loadUsers error:', err);
    toast('❌ Kan gebruikers niet laden');
  }
}

async function updateUser(userId) {
  const name = $(`#name_${userId}`)?.value?.trim();
  const phone = $(`#phone_${userId}`)?.value?.trim();
  const wic = $(`#wic_${userId}`)?.checked || false;

  if (!name) return toast('⚠️ Naam verplicht');

  await supabase.from('users')
    .update({ name, phone, WIcreations: wic })
    .eq('id', userId);

  toast('✅ Opgeslagen');
  await loadUsers();
}

async function zeroUser(userId) {
  if (!confirm('Gebruiker resetten?')) return;
  await supabase.from('drinks').delete().eq('user_id', userId);
  toast('✅ Gebruiker gereset');
  await loadUsers();
}

async function markAsPaid(userId) {
  const { data: unpaid } = await supabase
    .from('drinks')
    .select('price_at_purchase')
    .eq('user_id', userId)
    .or('paid.eq.false,paid.is.null');

  const total = (unpaid || []).reduce(
    (s, d) => s + Number(d.price_at_purchase || 0),
    0
  );

  if (!(total > 0)) return toast('Geen openstaand saldo');

  await supabase.from('drinks')
    .update({ paid: true })
    .eq('user_id', userId)
    .or('paid.eq.false,paid.is.null');

  await supabase.from('payments')
    .insert([{ user_id: userId, amount: total }]);

  toast(`✅ Betaald: €${total.toFixed(2)}`);
  await loadUsers();
}

async function deleteUser(userId) {
  if (!confirm('Gebruiker verwijderen?')) return;
  await supabase.from('users').delete().eq('id', userId);
  toast('✅ Gebruiker verwijderd');
  await loadUsers();
}

/* ---------- Productbeheer ---------- */
async function loadProducts() {
  const { data: products } = await supabase
    .from('products')
    .select('id, name, price, image_url')
    .order('name');

  const rows = (products || []).map(p => `
    <tr>
      <td>${
        p.image_url
          ? `<img src="${supabase.storage
              .from('product-images')
              .getPublicUrl(p.image_url).data.publicUrl}" width="40">`
          : '—'
      }</td>
      <td><input id="name_${p.id}" class="input" value="${esc(p.name)}" /></td>
      <td><input id="price_${p.id}" class="input" type="number" step="0.01" value="${Number(p.price).toFixed(2)}" /></td>
      <td>
        <button class="btn" onclick="updateProduct('${p.id}')">💾 Opslaan</button>
        <button class="btn" onclick="deleteProduct('${p.id}')">❌ Verwijderen</button>
      </td>
    </tr>
  `).join('');

  $('#tbl-products').innerHTML = rows;
}

async function addProduct() {
  const name = $('#new-product-name')?.value?.trim();
  const price = parseFloat($('#new-product-price')?.value?.replace(',', '.'));
  const file = $('#new-product-image')?.files?.[0];

  if (!name || !Number.isFinite(price)) {
    return toast('⚠️ Ongeldige invoer');
  }

  let image_url = null;
  if (file) {
    const filename = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    await supabase.storage.from('product-images').upload(filename, file);
    image_url = filename;
  }

  await supabase.from('products').insert([{ name, price, image_url }]);
  toast('✅ Product toegevoegd');
  await loadProducts();
}

async function updateProduct(productId) {
  const name = $(`#name_${productId}`)?.value?.trim();
  const price = parseFloat($(`#price_${productId}`)?.value?.replace(',', '.'));

  if (!name || !Number.isFinite(price)) {
    return toast('⚠️ Ongeldige invoer');
  }

  await supabase.from('products')
    .update({ name, price })
    .eq('id', productId);

  toast('✅ Product opgeslagen');
  await loadProducts();
}

async function deleteProduct(productId) {
  if (!confirm('Product verwijderen?')) return;
  await supabase.from('products').delete().eq('id', productId);
  toast('✅ Product verwijderd');
  await loadProducts();
}

/* ---------- Expose ---------- */
Object.assign(window, {
  updateUser,
  zeroUser,
  markAsPaid,
  deleteUser,
  addProduct,
  updateProduct,
  deleteProduct,
});
