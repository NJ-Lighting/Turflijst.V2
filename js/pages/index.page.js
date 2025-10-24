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

// Anti-spam flags + throttle
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

  // Maak echte <option>-regels met value="id"
  const parts = [
    '<option value="">-- Kies gebruiker --</option>'
  ];
  let seenSplit = false;
  sorted.forEach(u => {
    if (!u.WIcreations && !seenSplit) {
      parts.push('<option value="" disabled>────────────</option>');
      seenSplit = true;
    }
    parts.push(`<option value="${esc(u.id)}">${esc(u.name)}</option>`);
  });
  sel.innerHTML = parts.join('');
}

async function loadProducts() {
  const [{ data: products, error }, { data: batches, error: stockErr }] = await Promise.all([
    supabase.from('products').select('id, name, price, image_url').order('name', { ascending: true }),
    supabase.from('stock_batches').select('product_id, quantity').gt('quantity', 0)
  ]);
  if (error) return console.error(error);
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

  (products || [])
    .filter(p => (stockMap.get(p.id) || 0) > 0)
    .forEach(p => {
      const wrap = document.createElement('div');
      const btn = document.createElement('button');
      btn.className = 'btn drink-btn';
      btn.type = 'button';
      const imgTag = p.image_url ? `<img alt="" loading="lazy" src="${BUCKET_URL}${esc(p.image_url)}" />` : '';
      btn.innerHTML = `${imgTag}
${esc(p.name)}
${euro(p.price)}
`;
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          await logDrink(p.id);
        } finally {
          btn.disabled = false;
        }
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

  // 1) Oudste batch met voorraad (FIFO)
  const { data: oldest, error: obErr } = await supabase
    .from('stock_batches')
    .select('id, quantity, price_per_piece')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (obErr || !oldest || (Number(oldest.quantity) || 0) <= 0) {
    setUiBusy(false);
    isLogging = false;
    return toast('❌ Geen voorraad meer voor dit product');
  }

  // 2) Drink wegschrijven met vaste batch-prijs
  {
    const { error: dErr } = await supabase.from('drinks').insert([{
      user_id: userId,
      product_id: productId,
      price_at_purchase: oldest.price_per_piece,
      batch_id: oldest.id
    }]);
    if (dErr) {
      setUiBusy(false);
      isLogging = false;
      return toast('❌ Fout bij loggen drankje');
    }
  }

  // 3) Batch -1
  {
    const newQty = (Number(oldest.quantity) || 0) - 1;
    const { error: uErr } = await supabase.from('stock_batches')
      .update({ quantity: newQty })
      .eq('id', oldest.id);
    if (uErr) {
      setUiBusy(false);
      isLogging = false;
      return toast('❌ Fout bij afboeken voorraad');
    }
  }

  await loadProducts();

  const sel = $('#user');
  if (sel) sel.value = '';

  try {
    toast('✅ Drankje toegevoegd');
    await renderTotalsFromMetrics();
    await renderPivotFromMetrics();
    canUndo = true;
  } finally {
    setUiBusy(false);
    isLogging = false;
  }
};

window.undoLastDrink = async (el) => {
  if (!canUndo) {
    toast('Niets om ongedaan te maken');
    return;
  }
  if (el && !el.disabled) el.disabled = true;

  const now = Date.now();
  if (isUndoing || (now - lastUndoAt) < THROTTLE_MS) {
    if (el) el.disabled = false;
    return;
  }

  lastUndoAt = now;
  isUndoing = true;
  setUiBusy(true);

  // laatste drink incl. batch & prijs
  const { data: last, error } = await supabase
    .from('drinks')
    .select('id, user_id, product_id, batch_id, price_at_purchase')
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

  // drink verwijderen
  {
    const { error: delErr } = await supabase.from('drinks').delete().eq('id', last.id);
    if (delErr) {
      setUiBusy(false);
      isUndoing = false;
      if (el) el.disabled = false;
      return toast('❌ Fout bij verwijderen drankje');
    }
  }

  // voorraad exact op oorspronkelijke batch terugboeken (of nieuwe batch met bewaarde prijs)
  if (last.batch_id) {
    const { data: b, error: bErr } = await supabase
      .from('stock_batches')
      .select('id, quantity')
      .eq('id', last.batch_id)
      .maybeSingle();
    if (!bErr && b) {
      await supabase.from('stock_batches')
        .update({ quantity: (Number(b.quantity) || 0) + 1 })
        .eq('id', b.id);
    } else {
      await supabase.from('stock_batches').insert([{
        product_id: last.product_id,
        quantity: 1,
        price_per_piece: last.price_at_purchase
      }]);
    }
  } else {
    await supabase.from('stock_batches').insert([{
      product_id: last.product_id,
      quantity: 1,
      price_per_piece: last.price_at_purchase ?? 0
    }]);
  }

  await loadProducts();

  try {
    toast('⏪ Laatste drankje verwijderd');
    await renderTotalsFromMetrics();
    await renderPivotFromMetrics();
    canUndo = false;
  } finally {
    setUiBusy(false);
    isUndoing = false;
    if (el) el.disabled = false;
  }
};

async function renderTotalsFromMetrics(){
  try{
    $('#totalToPayList').innerHTML = `Laden…`;
    const rows = await fetchUserTotalsCurrentPrice(supabase);
    // Render als echte tabelrijen
    $('#totalToPayList').innerHTML =
      (rows || []).map(r =>
        `<tr><td>${esc(r.name)}</td><td class="right">${euro(r.amount)}</td></tr>`
      ).join('') || `<tr><td colspan="2" class="muted">Nog geen data</td></tr>`;
  }catch(e){
    console.error('renderTotalsFromMetrics:', e);
    $('#totalToPayList').innerHTML = `<tr><td colspan="2" class="muted">Kon bedragen niet laden</td></tr>`;
  }
}

async function renderPivotFromMetrics(){
  try{
    const { products, rows } = await fetchUserDrinkPivot(supabase);
    // Header + body als <tr><th/td>
    $('#userDrinkTotalsHead').innerHTML =
      `<tr><th>Gebruiker</th>${products.map(p => `<th class="right">${esc(p)}</th>`).join('')}</tr>`;
    $('#userDrinkTotalsBody').innerHTML =
      (rows || []).map(r =>
        `<tr><td>${esc(r.user)}</td>${r.counts.map(c => `<td class="right">${c}</td>`).join('')}</tr>`
      ).join('') || `<tr><td colspan="${1 + (products?.length||0)}" class="muted">Nog geen data</td></tr>`;
  } catch(e){
    console.error('renderPivotFromMetrics:', e);
    $('#userDrinkTotalsHead').innerHTML = '';
    $('#userDrinkTotalsBody').innerHTML = `<tr><td class="muted">Kon gegevens niet laden</td></tr>`;
  }
}
