import { $, toast, euro, esc } from '../core.js';
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

// Anti-spam flags + (robuuste) UI-disable + tijdstempel-throttle
let isLogging = false;
let isUndoing = false;
let lastLogAt = 0;
let lastUndoAt = 0;
const THROTTLE_MS = 600;
// Max 1 undo per laatst gelogde actie
let canUndo = false;

function setUiBusy(busy) {
  document.querySelectorAll('#product-buttons button.btn').forEach(b => b.disabled = busy);
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.disabled = busy;
  const grid = document.getElementById('product-buttons');
  if (grid) {
    grid.style.pointerEvents = busy ? 'none' : '';
    grid.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
}

async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, "WIcreations"');
  if (error) return console.error(error);

  const sel = $('#user');
  if (!sel) return;

  const coll = new Intl.Collator('nl', { sensitivity:'base' });
  const sorted = (users || []).slice().sort((a,b) => {
    if (!!a.WIcreations !== !!b.WIcreations) return a.WIcreations ? -1 : 1;
    return coll.compare(a.name, b.name);
  });

  let html = `<option value="">-- Kies gebruiker --</option>`;
  let seenSplit = false;
  sorted.forEach(u => {
    if (!u.WIcreations && !seenSplit) { html += `<option disabled>────────────</option>`; seenSplit = true; }
    html += `<option value="${esc(u.id)}">${esc(u.name)}</option>`;
  });
  sel.innerHTML = html;
}

async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price, image_url')
    .order('name', { ascending: true });
  if (error) return console.error(error);

  const { data: batches, error: stockErr } = await supabase
    .from('stock_batches')
    .select('product_id, quantity')
    .gt('quantity', 0);
  if (stockErr) return console.error(stockErr);
  const stockMap = new Map();
  (batches || []).forEach(b => {
    const q = Number(b.quantity) || 0;
    stockMap.set(b.product_id, (stockMap.get(b.product_id) || 0) + q);
  });

  const grid = $('#product-buttons');
  if (!grid) return;
  grid.classList.add('product-grid');
  grid.innerHTML = '';

  const BUCKET_URL = 'https://stmpommlhkokcjkwivfc.supabase.co/storage/v1/object/public/product-images/';

  (products || []).filter(p => (stockMap.get(p.id) || 0) > 0).forEach(p => {
    const wrap = document.createElement('div');
    const btn  = document.createElement('button');
    btn.className = 'btn drink-btn';
    btn.type = 'button';
    const imgTag = p.image_url ? `<img src="${BUCKET_URL + esc(p.image_url)}" alt="${esc(p.name)}">` : '';
    btn.innerHTML = `${imgTag}<div><div>${esc(p.name)}</div><div>${euro(p.price)}</div></div>`;
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try { await logDrink(p.id); }
      finally { btn.disabled = false; }
    });
    wrap.appendChild(btn);
    grid.appendChild(wrap);
  });
}

window.logDrink = async (productId) => {
  const now = Date.now();
  if (isLogging || (now - lastLogAt) < THROTTLE_MS) return;
  lastLogAt = now;

  isLogging = true;
  setUiBusy(true);

  const userId = $('#user').value;
  if (!userId) {
    setUiBusy(false);
    isLogging = false;
    return toast('⚠️ Kies eerst een gebruiker');
  }

  const { data: product } = await supabase.from('products').select('price').eq('id', productId).single();
  const price = product?.price || 0;

  await supabase.from('drinks').insert([{ user_id: userId, product_id: productId }]);

  const { data: fifo, error: bErr } = await supabase
    .from('stock_batches')
    .select('*')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at', { ascending: true });
  if (!bErr && Array.isArray(fifo)) {
    let remaining = 1;
    for (const batch of fifo) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(batch.quantity) || 0);
      if (take > 0) {
        await supabase.from('stock_batches')
          .update({ quantity: (Number(batch.quantity) || 0) - take })
          .eq('id', batch.id);
        remaining -= take;
      }
    }
    if (fifo.length > 0 && fifo[0]?.price_per_piece != null) {
      await supabase.from('products')
        .update({ price: fifo[0].price_per_piece })
        .eq('id', productId);
    }
  }

  await loadProducts();
  const sel = $('#user'); if (sel) sel.value = '';

  try {
    toast('✅ Drankje toegevoegd');
    await renderTotalsFromMetrics();
    await renderPivotFromMetrics();
    // precies 1 undo toestaan
    canUndo = true;
  } finally {
    setUiBusy(false);
    isLogging = false;
  }
};

window.undoLastDrink = async (el) => {
  // Sta maar 1 undo toe sinds de laatste log
  if (!canUndo) { toast('Niets om ongedaan te maken'); return; }

  if (el && !el.disabled) el.disabled = true;

  const now = Date.now();
  if (isUndoing || (now - lastUndoAt) < THROTTLE_MS) {
    if (el) el.disabled = false;
    return;
  }
  lastUndoAt = now;

  isUndoing = true;
  setUiBusy(true);

  const { data: last, error } = await supabase
    .from('drinks')
    .select('id, user_id, product_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !last) {
    toast('❌ Geen drankje om te verwijderen');
    setUiBusy(false);
    isUndoing = false;
    if (el) el.disabled = false;
    return;
  }

  await supabase.from('drinks').delete().eq('id', last.id);

  const { data: prod } = await supabase.from('products').select('price').eq('id', last.product_id).single();
  const price = prod?.price || 0;

  const { data: recentBatch, error: rbErr } = await supabase
    .from('stock_batches')
    .select('id, quantity, price_per_piece')
    .eq('product_id', last.product_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!rbErr && recentBatch) {
    await supabase.from('stock_batches')
      .update({ quantity: (Number(recentBatch.quantity) || 0) + 1 })
      .eq('id', recentBatch.id);
  } else {
    await supabase.from('stock_batches')
      .insert([{ product_id: last.product_id, quantity: 1, price_per_piece: price }]);
  }

  await loadProducts();

  try {
    toast('⏪ Laatste drankje verwijderd');
    await renderTotalsFromMetrics();
    await renderPivotFromMetrics();
    // verdere undos blokkeren tot er weer een log is
    canUndo = false;
  } finally {
    setUiBusy(false);
    isUndoing = false;
    if (el) el.disabled = false;
  }
};

async function renderTotalsFromMetrics(){
  try{
    $('#totalToPayList').innerHTML = `<tr><td colspan="2">Laden…</td></tr>`;
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
