// /js/pages/admin.page.js
import { $, $$, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserMetrics } from '../api/metrics.js';

document.addEventListener('DOMContentLoaded', async () => {
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

    // Primair via metrics (total = som onbetaald met historische prijs)
    const balances = new Map();
    try {
      const metrics = await fetchUserMetrics(supabase); // [{id, total, ...}]
      for (const m of (metrics || [])) balances.set(m.id, Number(m.total || 0));
      console.log('[loadUsers] metrics totals loaded. sample:', (metrics || []).slice(0, 3));
    } catch {}

    // Fallback: directe som price_at_purchase van onbetaald (paid=false/NULL)
    if (!balances.size) {
      const { data: drinks } = await supabase
        .from('drinks')
        .select('user_id, price_at_purchase, paid')
        .or('paid.eq.false,paid.is.null');
      const tmp = {};
      for (const d of (drinks || [])) {
        const uid = d.user_id;
        const price = Number(d?.price_at_purchase) || 0;
        tmp[uid] = (tmp[uid] || 0) + price;
      }
      for (const uid of Object.keys(tmp)) balances.set(uid, tmp[uid]);
      console.log('[loadUsers] Fallback totals computed. size=', balances.size);
    }

    // 🕓 Flags laden (wie heeft "Betalen" gemeld?)
    const flags = new Map();
    try {
      const { data: pf } = await supabase
        .from('payment_flags')
        .select('user_id, attempted_at');
      for (const r of (pf || [])) flags.set(r.user_id, r.attempted_at);
    } catch (e) {
      console.warn('[admin] payment_flags load error:', e?.message || e);
    }

    const rows = (users || []).map(u => {
      const due = balances.get(u.id) || 0;
      const attemptISO = flags.get(u.id) || null;
      const attemptText = attemptISO
        ? new Date(attemptISO).toLocaleString('nl-NL', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        : null;
      const accCell = attemptISO
        ? `🕓 <small title="Gemeld op: ${attemptText}">${attemptText}</small> <button class="btn btn-small" onclick="clearPaymentFlag('${u.id}')">🗑️</button>`
        : '—';

      // Let op: onderstaande <td>-volgorde moet aansluiten op jouw admin.html headers.
      return `
        <tr>
          <td>
            <input id="name_${u.id}" value="${esc(u.name || '')}" class="input" />
            <br/>
            <small>Tel:</small>
            <input id="phone_${u.id}" value="${esc(u.phone || '')}" class="input" />
            <label style="margin-left:6px">
              <input type="checkbox" id="wic_${u.id}" ${u.WIcreations ? 'checked' : ''} />
              WIcreations
            </label>
          </td>
          <td>€${Number.isFinite(due) ? due.toFixed(2) : '0.00'}</td>
          <td class="acc-cell">${accCell}</td>
          <td>
            <button class="btn btn-small" onclick="updateUser('${u.id}')">Opslaan</button>
            <button class="btn btn-small" onclick="zeroUser('${u.id}')">Reset</button>
            <button class="btn btn-small" onclick="markAsPaid('${u.id}')">✅ Betaald</button>
            <button class="btn btn-small" onclick="deleteUser('${u.id}')">❌ Verwijderen</button>
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
  const wiChecked = $(`#wic_${userId}`)?.checked ? true : false;
  if (!newName) return toast('⚠️ Naam mag niet leeg zijn!');

  const payload = { name: newName, WIcreations: wiChecked };
  if (newPhone !== undefined) payload.phone = newPhone;

  const { error } = await supabase.from('users').update(payload).eq('id', userId);
  if (error) {
    console.error('updateUser error:', error);
    return toast('❌ Fout bij opslaan');
  }
  toast('✅ Gegevens opgeslagen');
  await loadUsers();
}

async function zeroUser(userId) {
  if (!confirm('Weet je zeker dat je deze gebruiker wilt resetten?')) return;
  const { error } = await supabase.from('drinks').delete().eq('user_id', userId);
  if (error) {
    console.error('zeroUser error:', error);
    return toast('❌ Fout bij resetten');
  }
  toast('✅ Gebruiker is gereset');
  await loadUsers();
}

async function markAsPaid(userId) {
  try {
    // 0) Selecteer alle onbetaalde items vooraf
    const { data: unpaid, error: selErr } = await supabase
      .from('drinks')
      .select('id, price_at_purchase, paid')
      .eq('user_id', userId)
      .or('paid.eq.false,paid.is.null');
    if (selErr) {
      console.error('[markAsPaid] select unpaid error:', selErr);
      return toast('❌ Kan onbetaalde items niet ophalen');
    }
    console.table(unpaid, ['id', 'price_at_purchase', 'paid']);

    const total = (unpaid || []).reduce((s, d) => s + (Number(d?.price_at_purchase) || 0), 0);
    if (!(total > 0)) return toast('Geen onbetaalde items');
    const ids = (unpaid || []).map(d => d.id);
    if (!ids.length) return toast('Geen onbetaalde items gevonden');

    // 1) Snel: conditioneel alle unpaid van user op paid=true
    let { error: updErr1, count: count1 } = await supabase
      .from('drinks')
      .update({ paid: true })
      .eq('user_id', userId)
      .or('paid.eq.false,paid.is.null')
      .select('id', { count: 'exact' });
    if (updErr1) {
      console.warn('[markAsPaid] conditional update error, fallback to .in()', updErr1);
      count1 = 0;
    }
    console.log('[markAsPaid] conditional rows updated:', count1 || 0);

    // 2) Hercheck – indien nodig fallback met .in(ids)
    let { data: stillUnpaid, error: reErr1 } = await supabase
      .from('drinks')
      .select('id')
      .eq('user_id', userId)
      .or('paid.eq.false,paid.is.null');
    if (reErr1) console.error('[markAsPaid] recheck#1 error:', reErr1);
    const remain1 = stillUnpaid?.length || 0;
    console.log('[markAsPaid] unpaid after conditional update:', remain1);

    if (remain1 > 0) {
      const { error: updErr2, count: count2 } = await supabase
        .from('drinks')
        .update({ paid: true })
        .in('id', ids)
        .select('id', { count: 'exact' });
      if (updErr2) {
        console.error('[markAsPaid] fallback .in(ids) failed:', updErr2);
        return toast('❌ Markeren als betaald is deels mislukt');
      }
      console.log('[markAsPaid] fallback .in(ids) rows updated:', count2 || 0);

      // 3) Laatste hercheck
      const { data: stillUnpaid2, error: reErr2 } = await supabase
        .from('drinks')
        .select('id')
        .eq('user_id', userId)
        .or('paid.eq.false,paid.is.null');
      if (reErr2) console.error('[markAsPaid] recheck#2 error:', reErr2);
      const remain2 = stillUnpaid2?.length || 0;
      console.log('[markAsPaid] unpaid after fallback update:', remain2);
      if (remain2 > 0) {
        toast(`⚠️ ${remain2} item(s) konden niet op betaald gezet worden`);
      }
    }

    // 4) Payment loggen (audit)
    const { error: payErr } = await supabase
      .from('payments')
      .insert([{ user_id: userId, amount: total }]);
    if (payErr) {
      console.error('payment insert error:', payErr);
      return toast('❌ Betaling registreren mislukt');
    }

    // 5) Eventuele vlag wissen
    try { await supabase.from('payment_flags').delete().eq('user_id', userId); } catch {}

    toast(`✅ Betaling van €${total.toFixed(2)} geregistreerd`);
    await loadUsers(); // moet due → 0 maken
  } catch (e) {
    console.error('markAsPaid fatal error:', e);
    toast('❌ Onbekende fout bij betaling');
  }
}

async function deleteUser(userId) {
  if (!confirm('Weet je zeker dat je deze gebruiker wilt verwijderen?')) return;
  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) {
    console.error('deleteUser error:', error);
    return toast('❌ Verwijderen mislukt');
  }
  toast('✅ Gebruiker verwijderd');
  await loadUsers();
}

/* ---------- Productbeheer ---------- */
async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price, image_url')
    .order('name', { ascending: true });
  if (error) {
    console.error('loadProducts error:', error);
    return toast('❌ Kon producten niet laden');
  }

  function imgCell(p) {
    if (!p?.image_url) return '—';
    try {
      const { data } = supabase.storage.from('product-images').getPublicUrl(p.image_url);
      const url = data?.publicUrl || '#';
      return `<img alt="${esc(p.name)}" src="${esc(url)}" style="height:28px">`;
    } catch {
      return '—';
    }
  }

  const rows = (products || []).map(p => {
    const v = Number.isFinite(Number(p.price)) ? Number(p.price).toFixed(2) : '0.00';
    return `
      <tr>
        <td>${imgCell(p)}</td>
        <td><input id="name_${p.id}" value="${esc(p.name || '')}" class="input" /></td>
        <td><input id="price_${p.id}" value="${v}" class="input" /></td>
        <td>
          <button class="btn btn-small" onclick="updateProduct('${p.id}')">Opslaan</button>
          <button class="btn btn-small" onclick="deleteProduct('${p.id}')">❌ Verwijderen</button>
        </td>
      </tr>
    `;
  }).join('');

  if ($('#tbl-products')) $('#tbl-products').innerHTML = rows;
  if ($('#productTable')) $('#productTable').innerHTML = rows;
}

async function addProduct() {
  const name = $('#new-product-name')?.value?.trim() || $('#newProductName')?.value?.trim();
  const price = parseFloat((($('#new-product-price')?.value ?? $('#newProductPrice')?.value) || '').replace(',', '.'));
  const file = ($('#new-product-image') || $('#productImage'))?.files?.[0];

  if (!name || !Number.isFinite(price)) return toast('⚠️ Ongeldige invoer');

  let image_url = null;
  if (file) {
    const filename = `${Date.now()}_${file.name.replace(/\s+/g, '_').toLowerCase()}`;
    const { error: upErr } = await supabase.storage.from('product-images').upload(filename, file);
    if (upErr) {
      console.error('upload error:', upErr);
      return toast('❌ Upload mislukt');
    }
    image_url = filename;
  }

  const { error } = await supabase.from('products').insert([{ name, price, image_url }]);
  if (error) {
    console.error('addProduct error:', error);
    return toast('❌ Product toevoegen mislukt');
  }

  toast('✅ Product toegevoegd');
  if ($('#new-product-name')) $('#new-product-name').value = '';
  if ($('#newProductName')) $('#newProductName').value = '';
  if ($('#new-product-price')) $('#new-product-price').value = '';
  if ($('#newProductPrice')) $('#newProductPrice').value = '';
  if ($('#new-product-image')) $('#new-product-image').value = '';
  if ($('#productImage')) $('#productImage').value = '';
  await loadProducts();
}

async function updateProduct(productId) {
  const name = $(`#name_${productId}`)?.value?.trim();
  const price = parseFloat(($(`#price_${productId}`)?.value || '').replace(',', '.'));

  if (!name) return toast('⚠️ Naam is verplicht');
  if (!Number.isFinite(price) || price < 0) return toast('⚠️ Ongeldige prijs');

  const { error } = await supabase.from('products').update({ name, price }).eq('id', productId);
  if (error) {
    console.error('updateProduct error:', error);
    return toast('❌ Bijwerken mislukt');
  }

  toast('✅ Product opgeslagen');
  await loadProducts();
}

async function deleteProduct(productId) {
  if (!confirm('Weet je zeker dat je dit product wilt verwijderen?')) return;
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) {
    console.error('deleteProduct error:', error);
    return toast('❌ Verwijderen mislukt');
  }

  toast('✅ Product verwijderd');
  await loadProducts();
}

/* ---------- 🗑️ Vlag handmatig wissen ---------- */
async function clearPaymentFlag(userId) {
  try {
    const { error } = await supabase.from('payment_flags').delete().eq('user_id', userId);
    if (error) throw error;
    toast('🗑️ Meldvlag verwijderd');
    await loadUsers();
  } catch (e) {
    console.error('[clearPaymentFlag] error:', e);
    toast('❌ Vlag verwijderen mislukt');
  }
}

/* ---------- Expose (inline onclick expects globals) ---------- */
if (typeof window !== 'undefined') {
  Object.assign(window, {
    updateUser, zeroUser, markAsPaid, deleteUser, clearPaymentFlag,
    addProduct, updateProduct, deleteProduct,
  });
}
