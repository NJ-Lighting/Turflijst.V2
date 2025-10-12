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
      console.log('[loadUsers] metrics totals loaded. sample:', (metrics||[]).slice(0,3));
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
      console.log('[loadUsers] Fallback totals computed. size=', balances.size);
    }

    const rows = (users || []).map(u => {
      const due = balances.get(u.id) || 0;
      console.log('[loadUsers] user due', { userId: u.id, name: u.name, due });
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
  try {
    // 1) Onbetaald ophalen
    const { data: drinks, error } = await supabase
      .from('drinks')
      .select('id, price_at_purchase, paid')
      .eq('user_id', userId)
      .or('paid.eq.false,paid.is.null');
    if (error) {
      console.error('markAsPaid drinks error:', error);
      return toast('❌ Kan saldo niet bepalen');
    }
    console.table(drinks, ['id','price_at_purchase','paid']);

    const total = (drinks || []).reduce((sum, d) => sum + (Number(d?.price_at_purchase) || 0), 0);
    if (!(total > 0)) return toast('Geen onbetaalde items');

    // 2) Alles in één keer op paid=true
    const { data: updRows, error: updErr, count } = await supabase
      .from('drinks')
      .update({ paid: true })
      .eq('user_id', userId)
      .or('paid.eq.false,paid.is.null')
      .select('id, paid', { count: 'exact' });
    if (updErr) {
      console.error('[markAsPaid] update paid error:', updErr);
      return toast('❌ Kon drankjes niet markeren als betaald');
    }
    console.log('[markAsPaid] rows updated (paid=true):', count);
    if (!((updRows || []).every(r => r?.paid === true))) {
      console.warn('[markAsPaid] Niet alle regels staan op paid=true', updRows);
    }

    // 2b) Verifieer dat er niets onbetaald overblijft
    const { data: stillUnpaid, error: reErr } = await supabase
      .from('drinks')
      .select('id')
      .eq('user_id', userId)
      .or('paid.eq.false,paid.is.null');
    if (reErr) console.error('[markAsPaid] recheck error:', reErr);
    console.log('[markAsPaid] unpaid after update:', stillUnpaid?.length || 0);
    if ((stillUnpaid?.length || 0) > 0) {
      toast('⚠️ Niet alle items konden op betaald gezet worden');
    }

    // 3) Payment registreren
    const { error: payErr } = await supabase
      .from('payments')
      .insert([{ user_id: userId, amount: total }]);
    if (payErr) {
      console.error('payment insert error:', payErr);
      return toast('❌ Betaling registreren mislukt');
    }

    toast(`✅ Betaling van €${total.toFixed(2)} geregistreerd`);
    await loadUsers(); // haalt totals opnieuw
  } catch (e) {
    console.error('markAsPaid fatal error:', e);
    toast('❌ Onbekende fout bij betaling');
  }
}

/* ---------- Productbeheer (ongewijzigd) ---------- */
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

async function addProduct() { /* ongewijzigd */ }
async function updateProduct(productId) { /* ongewijzigd */ }
async function deleteProduct(productId) { /* ongewijzigd */ }

/* Expose */
window.updateUser = updateUser;
window.zeroUser = zeroUser;
window.markAsPaid = markAsPaid;
window.deleteUser = deleteUser;
window.addProduct = addProduct;
window.updateProduct = updateProduct;
window.deleteProduct = deleteProduct;
