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

// Anti-spam flags + (robuuste) UI-disable + tijdstempel-throttle + canUndo-state
let isLogging = false;
let isUndoing = false;
let lastLogAt = 0;
let lastUndoAt = 0;
const THROTTLE_MS = 600;
// Max 1 undo per laatst gelogde actie
let canUndo = false;

function updateUndoButton() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  btn.disabled = !canUndo;
  btn.setAttribute('aria-disabled', String(!canUndo));
  btn.title = canUndo ? 'Maak de laatste actie ongedaan' : 'Eerst een drankje loggen, daarna kun je één keer undo doen';
}

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
  if (error) { console.error(error); toast('❌ Fout bij laden gebruikers'); return; }

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
  // 1) Producten + batches parallel
  const [{ data: products, error }, { data: batches, error: stockErr }] = await Promise.all([
    supabase.from('products').select('id, name, price, image_url').order('name', { ascending: true }),
    supabase.from('stock_batches').select('product_id, quantity').gt('quantity', 0)
  ]);
  if (error) { console.error(error); toast('❌ Fout bij laden producten'); return; }
  if (stockErr) { console.error(stockErr); toast('❌ Fout bij laden voorraad'); return; }

  // 2) Actieve batches en som per product
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

  // 3) Alleen producten met voorraad renderen
  (products || []).filter(p => (stockMap.get(p.id) || 0) > 0).forEach(p => {
    const wrap = document.createElement('div');
    const btn  = document.createElement('button');
    btn.className = 'btn drink-btn';
    btn.type = 'button';
    const imgTag = p.image_url ? `<img src="${BUCKET_URL + esc(p.image_url)}" alt="${esc(p.name)}">` : '';
    btn.innerHTML = `${imgTag}<div><div>${esc(p.name)}</div><div>${euro(p.price)}</div></div>`;
    // Disable de knop direct bij klik; voorkomt dubbel fire
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

async function recalcProductPriceFromOldestBatch(productId) {
  // Zoek actuele oudste batch (na de mutatie)
  const { data: batches, error } = await supabase
    .from('stock_batches')
    .select('price_per_piece, quantity')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at', { ascending: true });
  if (error) { console.error(error); toast('❌ Fout bij herberekenen prijs'); return; }
  if (batches && batches.length > 0 && batches[0]?.price_per_piece != null) {
    const newPrice = batches[0].price_per_piece;
    const { error: uErr } = await supabase.from('products').update({ price: newPrice }).eq('id', productId);
    if (uErr) { console.error(uErr); toast('❌ Fout bij opslaan nieuwe prijs'); }
  }
}

window.logDrink = async (productId) => {
  const now = Date.now();
  if (isLogging || (now - lastLogAt) < THROTTLE_MS) return; // dubbelklik/spam protect
  lastLogAt = now;

  isLogging = true;
  setUiBusy(true);

  const userId = $('#user').value;
  if (!userId) {
    setUiBusy(false);
    isLogging = false;
    return toast('⚠️ Kies eerst een gebruiker');
  }

  // Guard: als prijs ontbreekt, herstel vanuit oudste batch
  const { data: product, error: pErr } = await supabase.from('products').select('price').eq('id', productId).single();
  if (pErr) { console.error(pErr); toast('❌ Fout bij lezen product'); }
  let price = product?.price;
  if (price == null) {
    toast('ℹ️ Productprijs ontbrak — herstellen uit oudste batch…');
    const { data: b } = await supabase
      .from('stock_batches')
      .select('price_per_piece')
      .eq('product_id', productId)
      .gt('quantity', 0)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (b?.price_per_piece != null) {
      const { error: uErr } = await supabase.from('products').update({ price: b.price_per_piece }).eq('id', productId);
      if (uErr) { console.error(uErr); toast('❌ Fout bij opslaan herstelde prijs'); }
      price = b.price_per_piece;
    } else {
      toast('⚠️ Geen batchprijs gevonden — ga door zonder prijsupdate');
    }
  }

  // Insert drink
  {
    const { error: dErr } = await supabase.from('drinks').insert([{ user_id: userId, product_id: productId }]);
    if (dErr) { console.error(dErr); toast('❌ Fout bij loggen drankje'); setUiBusy(false); isLogging = false; return; }
  }

  // (1) FIFO voorraad verlagen
  const { data: fifo, error: bErr } = await supabase
    .from('stock_batches')
    .select('*')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at', { ascending: true });
  if (bErr) { console.error(bErr); toast('❌ Fout bij lezen voorraad'); }
  if (!bErr && Array.isArray(fifo)) {
    let remaining = 1;
    for (const batch of fifo) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(batch.quantity) || 0);
      if (take > 0) {
        const { error: uErr } = await supabase.from('stock_batches')
          .update({ quantity: (Number(batch.quantity) || 0) - take })
          .eq('id', batch.id);
        if (uErr) { console.error(uErr); toast('❌ Fout bij afboeken voorraad'); }
        remaining -= take;
      }
    }
    // (2) Prijs opnieuw bepalen na mutatie
    await recalcProductPriceFromOldestBatch(productId);
  }

  // (3) Products herladen
  await loadProducts();
  // (4) User dropdown resetten
  const sel = $('#user'); if (sel) sel.value = '';

  try {
    toast('✅ Drankje toegevoegd');
    await renderTotalsFromMetrics();
    await renderPivotFromMetrics();
    // precies 1 undo toestaan
    canUndo = true;
    updateUndoButton();
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

  // (5) Globaal laatste drankje
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

  // Delete drink
  {
    const { error: delErr } = await supabase.from('drinks').delete().eq('id', last.id);
    if (delErr) { console.error(delErr); toast('❌ Fout bij verwijderen drankje'); setUiBusy(false); isUndoing = false; if (el) el.disabled = false; return; }
  }

  // Huidige productprijs voor evt. nieuwe batch
  const { data: prod } = await supabase.from('products').select('price').eq('id', last.product_id).single();
  const price = prod?.price || 0;

  // Voorraad terugboeken: +1 op meest recente batch of nieuwe batch maken
  const { data: recentBatch, error: rbErr } = await supabase
    .from('stock_batches')
    .select('id, quantity, price_per_piece')
    .eq('product_id', last.product_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (rbErr) { console.error(rbErr); toast('❌ Fout bij lezen batches voor undo'); }
  if (!rbErr && recentBatch) {
    const { error: uErr } = await supabase.from('stock_batches')
      .update({ quantity: (Number(recentBatch.quantity) || 0) + 1 })
      .eq('id', recentBatch.id);
    if (uErr) { console.error(uErr); toast('❌ Fout bij terugboeken voorraad'); }
  } else {
    const { error: iErr } = await supabase.from('stock_batches')
      .insert([{ product_id: last.product_id, quantity: 1, price_per_piece: price }]);
    if (iErr) { console.error(iErr); toast('❌ Fout bij aanmaken batch (undo)'); }
  }

  // Prijs opnieuw bepalen na undo
  await recalcProductPriceFromOldestBatch(last.product_id);

  // Products herladen na undo
  await loadProducts();

  try {
    toast('⏪ Laatste drankje verwijderd');
    await renderTotalsFromMetrics();
    await renderPivotFromMetrics();
    // verdere undos blokkeren tot er weer een log is
    canUndo = false;
    updateUndoButton();
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
      (rows || []).map(r => `<tr><td scope="row">${esc(r.name)}</td><td class="right">${euro(r.amount)}</td></tr>`).join('') ||
      `<tr><td colspan="2" style="opacity:.7">Nog geen data</td></tr>`;
  }catch(e){
    console.error('renderTotalsFromMetrics:', e);
    $('#totalToPayList').innerHTML = `<tr><td colspan="2">Kon bedragen niet laden</td></tr>`;
    toast('❌ Fout bij laden totalen');
  }
}

async function renderPivotFromMetrics(){
  try{
    const { products, rows } = await fetchUserDrinkPivot(supabase);
    $('#userDrinkTotalsHead').innerHTML =
      `<tr><th scope="col">Gebruiker</th>${products.map(p => `<th class="right" scope="col">${esc(p)}</th>`).join('')}</tr>`;
    $('#userDrinkTotalsBody').innerHTML =
      (rows || []).map(r => `<tr><td scope="row">${esc(r.user)}</td>${r.counts.map(c => `<td class="right">${c}</td>`).join('')}</tr>`).join('') ||
      `<tr><td colspan="${1 + products.length}" style="opacity:.7">Nog geen data</td></tr>`;
  } catch(e){
    console.error('renderPivotFromMetrics:', e);
    $('#userDrinkTotalsHead').innerHTML = '';
    $('#userDrinkTotalsBody').innerHTML = `<tr><td>Kon gegevens niet laden</td></tr>`;
    toast('❌ Fout bij laden overzicht');
  }
}
