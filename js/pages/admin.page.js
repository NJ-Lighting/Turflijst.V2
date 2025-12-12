// /js/pages/admin.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserMetrics } from '../api/metrics.js';

/* ---------------------------------------------------------
   AUTH / LOGIN (EMAIL + WACHTWOORD)
--------------------------------------------------------- */
function showLoginUI() {
  const login = document.getElementById('login-section');
  if (login) login.style.display = 'block';

  const btn = document.getElementById('btn-login');
  const msg = document.getElementById('auth-msg');

  btn?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;

    if (!email || !password) {
      if (msg) msg.textContent = 'Email en wachtwoord zijn verplicht';
      return;
    }

    if (msg) msg.textContent = 'Inloggen…';

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (msg) msg.textContent = '❌ Onjuist email of wachtwoord';
    } else {
      location.reload();
    }
  });
}

function showAdminUI() {
  const app = document.getElementById('app-content');
  if (app) app.style.display = 'block';

  $('#btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}

/* ---------------------------------------------------------
   INIT (MET ADMIN LOGIN-GATE)
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    showLoginUI();
    return;
  }

  const { data: admin } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (!admin) {
    alert('Geen toegang — admin only');
    await supabase.auth.signOut();
    return;
  }

  showAdminUI();

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
    if (uErr) return toast('❌ Kan gebruikers niet laden');

    const balances = new Map();
    try {
      const metrics = await fetchUserMetrics(supabase);
      for (const m of (metrics || [])) balances.set(m.id, Number(m.total || 0));
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

    const rows = (users || []).map(u => {
      const due = balances.get(u.id) || 0;
      return `
        <tr>
          <td><input id="name_${u.id}" class="input" value="${esc(u.name)}" /></td>
          <td><input id="phone_${u.id}" class="input" value="${esc(u.phone || '')}" /></td>
          <td><input id="wic_${u.id}" type="checkbox" ${u.WIcreations ? 'checked' : ''} /></td>
          <td>€${due.toFixed(2)}</td>
          <td>
            <button class="btn" onclick="updateUser('${u.id}')">💾 Opslaan</button>
            <button class="btn" onclick="zeroUser('${u.id}')">🔄 Reset</button>
            <button class="btn" onclick="markAsPaid('${u.id}')">✅ Betaald</button>
            <button class="btn" onclick="deleteUser('${u.id}')">❌ Verwijderen</button>
          </td>
        </tr>
      `;
    }).join('');

    $('#tbl-users') && ($('#tbl-users').innerHTML = rows);
  } catch {
    toast('❌ Kan gebruikers niet laden');
  }
}

async function updateUser(userId) {
  const newName = $(`#name_${userId}`)?.value?.trim() || '';
  const newPhone = $(`#phone_${userId}`)?.value?.trim() || '';
  const wiChecked = $(`#wic_${userId}`)?.checked ? true : false;

  if (!newName) return toast('⚠️ Naam mag niet leeg zijn!');

  const payload = { name: newName, WIcreations: wiChecked };
  if (newPhone !== undefined) payload.phone = newPhone;

  await supabase.from('users').update(payload).eq('id', userId);
  toast('✅ Gegevens opgeslagen');
  await loadUsers();
}

async function zeroUser(userId) {
  if (!confirm('Weet je zeker dat je deze gebruiker wilt resetten?')) return;
  await supabase.from('drinks').delete().eq('user_id', userId);
  toast('✅ Gebruiker is gereset');
  await loadUsers();
}

async function markAsPaid(userId) {
  const { data: unpaid } = await supabase
    .from('drinks')
    .select('price_at_purchase')
    .eq('user_id', userId)
    .or('paid.eq.false,paid.is.null');

  const total = (unpaid || []).reduce((s, d) => s + Number(d.price_at_purchase || 0), 0);
  if (!(total > 0)) return toast('Geen onbetaalde items');

  await supabase.from('drinks')
    .update({ paid: true })
    .eq('user_id', userId)
    .or('paid.eq.false,paid.is.null');

  await supabase.from('payments').insert([{ user_id: userId, amount: total }]);

  toast(`✅ Betaling van €${total.toFixed(2)} geregistreerd`);
  await loadUsers();
}

async function deleteUser(userId) {
  if (!confirm('Weet je zeker dat je deze gebruiker wilt verwijderen?')) return;
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
      <td>${p.image_url ? `<img src="${supabase.storage.from('product-images').getPublicUrl(p.image_url).data.publicUrl}" width="40">` : '—'}</td>
      <td><input id="name_${p.id}" class="input" value="${esc(p.name)}" /></td>
      <td><input id="price_${p.id}" class="input" type="number" step="0.01" value="${Number(p.price).toFixed(2)}" /></td>
      <td>
        <button class="btn" onclick="updateProduct('${p.id}')">💾 Opslaan</button>
        <button class="btn" onclick="deleteProduct('${p.id}')">❌ Verwijderen</button>
      </td>
    </tr>
  `).join('');

  $('#tbl-products') && ($('#tbl-products').innerHTML = rows);
}

async function addProduct() {
  const name = $('#new-product-name')?.value?.trim();
  const price = parseFloat($('#new-product-price')?.value?.replace(',', '.'));
  const file = $('#new-product-image')?.files?.[0];

  if (!name || !Number.isFinite(price)) return toast('⚠️ Ongeldige invoer');

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
  if (!name || !Number.isFinite(price)) return toast('⚠️ Ongeldige invoer');

  await supabase.from('products').update({ name, price }).eq('id', productId);
  toast('✅ Product opgeslagen');
  await loadProducts();
}

async function deleteProduct(productId) {
  if (!confirm('Weet je zeker dat je dit product wilt verwijderen?')) return;
  await supabase.from('products').delete().eq('id', productId);
  toast('✅ Product verwijderd');
  await loadProducts();
}

/* ---------- Expose ---------- */
if (typeof window !== 'undefined') {
  Object.assign(window, {
    updateUser,
    zeroUser,
    markAsPaid,
    deleteUser,
    addProduct,
    updateProduct,
    deleteProduct,
  });
}
