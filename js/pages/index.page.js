import { $, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserDrinkPivot, fetchUserTotalsCurrentPrice } from '../api/metrics.js';

/* ============================================================
   INIT
============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  await loadProducts();

  initQuantityControls();
  updateQuantityDisplay();

  $('#user')?.addEventListener('change', () => {
    renderTotalsFromMetrics();
    renderPivotFromMetrics();
  });

  await renderTotalsFromMetrics();
  await renderPivotFromMetrics();
});

/* ============================================================
   GLOBAL STATE
============================================================ */
let isLogging = false;
let isUndoing = false;
let lastLogAt = 0;
let lastUndoAt = 0;
const THROTTLE_MS = 500;

let canUndo = false;

let currentQuantity = 1;
const MIN_QTY = 1;
const MAX_QTY = 20;

/* ============================================================
   HELPERS
============================================================ */
function setUiBusy(busy) {
  document.querySelectorAll('#product-buttons button.btn')
    .forEach(b => (b.disabled = busy));

  const undoBtn = $('#undo-btn');
  if (undoBtn) undoBtn.disabled = busy;

  const grid = $('#product-buttons');
  if (grid) {
    grid.style.pointerEvents = busy ? 'none' : '';
    grid.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
}

function generateActionGroupId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateQuantityDisplay() {
  const el = $('#quantity-display');
  if (el) el.textContent = String(currentQuantity);
}

/* ============================================================
   QUANTITY CONTROLS
============================================================ */
function initQuantityControls() {
  const undoBtn = $('#undo-btn');
  if (!undoBtn) return;
  if ($('#quantity-controls')) return;

  const div = document.createElement('div');
  div.id = 'quantity-controls';
  div.className = 'quantity-controls';
  div.innerHTML = `
    <div class="quantity-label">Aantal:</div>
    <div class="quantity-input">
      <button type="button" class="btn quantity-minus">-</button>
      <span id="quantity-display" aria-live="polite">1</span>
      <button type="button" class="btn quantity-plus">+</button>
    </div>
  `;

  undoBtn.parentNode.insertBefore(div, undoBtn);

  div.querySelector('.quantity-minus')?.addEventListener('click', () => {
    if (currentQuantity > MIN_QTY) {
      currentQuantity--;
      updateQuantityDisplay();
    }
  });

  div.querySelector('.quantity-plus')?.addEventListener('click', () => {
    if (currentQuantity < MAX_QTY) {
      currentQuantity++;
      updateQuantityDisplay();
    }
  });
}

/* ============================================================
   USERS DROPDOWN
============================================================ */
async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, WIcreations');

  if (error) {
    console.error("User load error:", error);
    return;
  }

  const sel = $('#user');
  if (!sel) return;

  sel.innerHTML = `<option value="">-- Kies gebruiker --</option>`;

  if (!users || users.length === 0) {
    console.warn("Geen gebruikers gevonden");
    return;
  }

  const sorted = [...users].sort((a, b) => {
    if (!!a.WIcreations !== !!b.WIcreations) return a.WIcreations ? -1 : 1;
    return (a.name ?? "").localeCompare(b.name ?? "", "nl", { sensitivity: "base" });
  });

  let split = false;

  for (const u of sorted) {
    if (!u.WIcreations && !split) {
      sel.insertAdjacentHTML("beforeend", `<option disabled>────────────</option>`);
      split = true;
    }

    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${u.id}">${esc(u.name)}</option>`
    );
  }
}

/* ============================================================
   LOAD PRODUCTS
============================================================ */
async function loadProducts() {
  const [{ data: products }, { data: batches }] = await Promise.all([
    supabase.from('products').select('id, name, price, image_url').order('name'),
    supabase.from('stock_batches').select('product_id, quantity').gt('quantity', 0)
  ]);

  const stockMap = new Map();
  batches?.forEach(b => {
    stockMap.set(b.product_id, (stockMap.get(b.product_id) || 0) + Number(b.quantity));
  });

  const grid = $('#product-buttons');
  if (!grid) return;

  grid.innerHTML = '';
  grid.classList.add('product-grid');

  const BUCKET =
    "https://stmpommlhkokcjkwivfc.supabase.co/storage/v1/object/public/product-images/";

  products
    ?.filter(p => (stockMap.get(p.id) || 0) > 0)
    .forEach(p => {
      const wrap = document.createElement('div');
      const btn = document.createElement('button');
      btn.className = 'btn drink-btn';

      const img = p.image_url
        ? `<img src="${BUCKET}${encodeURIComponent(p.image_url)}" class="drink-img">`
        : '';

      btn.innerHTML = `${img} ${esc(p.name)} ${euro(p.price)}`;

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await logDrink(p.id, p.price, currentQuantity);
        } finally {
          btn.disabled = false;
        }
      });

      wrap.appendChild(btn);
      grid.appendChild(wrap);
    });
}

/* ============================================================
   LOG DRINK (BULK + FIFO)
============================================================ */
window.logDrink = async (productId, sellPrice, qty) => {
  const now = Date.now();
  if (isLogging || now - lastLogAt < THROTTLE_MS) return;

  lastLogAt = now;
  isLogging = true;
  setUiBusy(true);

  qty = Math.max(MIN_QTY, Math.min(MAX_QTY, Number(qty) || 1));

  const userId = $('#user').value;
  if (!userId) {
    toast('⚠️ Kies eerst een gebruiker');
    setUiBusy(false);
    isLogging = false;
    return;
  }

  const { data: batches } = await supabase
    .from('stock_batches')
    .select('id, quantity, price_per_piece')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at');

  if (!batches?.length) {
    toast('❌ Geen voorraad voor dit product');
    setUiBusy(false);
    isLogging = false;
    return;
  }

  const total = batches.reduce((sum, b) => sum + Number(b.quantity), 0);
  if (total < qty) {
    toast('❌ Niet genoeg voorraad');
    setUiBusy(false);
    isLogging = false;
    return;
  }

  let remaining = qty;
  const plan = [];

  for (const b of batches) {
    const available = Number(b.quantity);
    const use = Math.min(available, remaining);
    if (use > 0) {
      plan.push({
        batch_id: b.id,
        count: use,
        startQty: available,
        price_per_piece: b.price_per_piece
      });
      remaining -= use;
      if (remaining === 0) break;
    }
  }

  const groupId = generateActionGroupId();
  const rows = [];

  plan.forEach(entry => {
    for (let i = 0; i < entry.count; i++) {
      rows.push({
        user_id: userId,
        product_id: productId,
        price_at_purchase: entry.price_per_piece,
        batch_id: entry.batch_id,
        action_group_id: groupId
      });
    }
  });

  const { error: insertErr } = await supabase.from('drinks').insert(rows);
  if (insertErr) {
    console.error("INSERT ERROR:", insertErr);
    toast('❌ Fout bij loggen');
    setUiBusy(false);
    isLogging = false;
    return;
  }

  for (const p of plan) {
    await supabase
      .from('stock_batches')
      .update({ quantity: p.startQty - p.count })
      .eq('id', p.batch_id);
  }

  await loadProducts();
  currentQuantity = 1;
  updateQuantityDisplay();

  toast(qty === 1 ? '✅ Drankje toegevoegd' : `✅ ${qty} drankjes toegevoegd`);

  await renderTotalsFromMetrics();
  await renderPivotFromMetrics();

  // reset geselecteerde gebruiker na registreren
  const userSelect = $('#user');
  if (userSelect) userSelect.value = '';

  canUndo = true;
  setUiBusy(false);
  isLogging = false;
};

/* ============================================================
   UNDO GROUP
============================================================ */
async function restoreBatch(row) {
  if (row.batch_id) {
    const { data: b } = await supabase
      .from('stock_batches')
      .select('id, quantity')
      .eq('id', row.batch_id)
      .maybeSingle();

    if (b) {
      await supabase
        .from('stock_batches')
        .update({ quantity: Number(b.quantity) + 1 })
        .eq('id', b.id);
      return;
    }
  }

  await supabase.from('stock_batches').insert([{
    product_id: row.product_id,
    quantity: 1,
    price_per_piece: row.price_at_purchase
  }]);
}

window.undoLastDrink = async () => {
  if (!canUndo) return toast('Niets om ongedaan te maken');

  const now = Date.now();
  if (isUndoing || now - lastUndoAt < THROTTLE_MS) return;

  lastUndoAt = now;
  isUndoing = true;
  setUiBusy(true);

  const { data: last } = await supabase
    .from('drinks')
    .select('id, product_id, batch_id, price_at_purchase, action_group_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!last) {
    toast('Geen gegevens');
    setUiBusy(false);
    isUndoing = false;
    return;
  }

  let undone = 1;

  if (!last.action_group_id) {
    await supabase.from('drinks').delete().eq('id', last.id);
    await restoreBatch(last);

  } else {
    const { data: group } = await supabase
      .from('drinks')
      .select('id, product_id, batch_id, price_at_purchase')
      .eq('action_group_id', last.action_group_id);

    undone = group.length;

    await supabase.from('drinks')
      .delete()
      .eq('action_group_id', last.action_group_id);

    for (const row of group) {
      await restoreBatch(row);
    }
  }

  await loadProducts();
  await renderTotalsFromMetrics();
  await renderPivotFromMetrics();

  toast(
    undone === 1
      ? '⏪ Laatste drankje verwijderd'
      : `⏪ Laatste actie verwijderd (${undone} drankjes)`
  );

  canUndo = false;
  setUiBusy(false);
  isUndoing = false;
};

/* ============================================================
   TOTALS TABLE
============================================================ */
async function renderTotalsFromMetrics() {
  try {
    const rows = await fetchUserTotalsCurrentPrice(supabase);

    if (!rows || rows.length === 0) {
      $('#totalToPayList').innerHTML =
        `<tr><td colspan="2">Nog geen data</td></tr>`;
      return;
    }

    const body = rows.map(r => `
      <tr>
        <td>${esc(r.name)}</td>
        <td style="text-align:right">${euro(r.amount)}</td>
      </tr>
    `).join('');

    $('#totalToPayList').innerHTML = body;

  } catch (e) {
    console.error("Totals error:", e);
    $('#totalToPayList').innerHTML =
      `<tr><td colspan="2">Kon niet laden</td></tr>`;
  }
}

/* ============================================================
   PIVOT TABLE
============================================================ */
async function renderPivotFromMetrics() {
  try {
    const { products, rows } = await fetchUserDrinkPivot(supabase);

    const headHtml = `
      <tr>
        <th>Gebruiker</th>
        ${products.map(p => `<th>${esc(p)}</th>`).join('')}
      </tr>
    `;
    $('#userDrinkTotalsHead').innerHTML = headHtml;

    if (!rows || rows.length === 0) {
      $('#userDrinkTotalsBody').innerHTML =
        `<tr><td colspan="${products.length + 1}">Nog geen data</td></tr>`;
      return;
    }

    const bodyHtml = rows
      .map(r => `
        <tr>
          <td>${esc(r.user)}</td>
          ${r.counts.map(c => `<td>${c}</td>`).join('')}
        </tr>
      `)
      .join('');

    $('#userDrinkTotalsBody').innerHTML = bodyHtml;

  } catch (e) {
    console.error("Pivot error:", e);
    $('#userDrinkTotalsHead').innerHTML = '';
    $('#userDrinkTotalsBody').innerHTML =
      `<tr><td colspan="99">Kon gegevens niet laden</td></tr>`;
  }
}
