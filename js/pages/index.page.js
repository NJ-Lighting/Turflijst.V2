import { $, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import { fetchUserDrinkPivot, fetchUserTotalsCurrentPrice } from '../api/metrics.js';

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

// Anti-spam flags + throttle
let isLogging = false;
let isUndoing = false;
let lastLogAt = 0;
let lastUndoAt = 0;
const THROTTLE_MS = 600;
// Max 1 undo per laatst gelogde actie
let canUndo = false;

// Centrale hoeveelheid-teller (onder de drankjes, boven undo)
let currentQuantity = 1;
const MIN_QTY = 1;
const MAX_QTY = 10; // eventueel aanpassen

function setUiBusy(busy) {
  document
    .querySelectorAll('#product-buttons button.btn')
    .forEach((b) => (b.disabled = busy));

  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.disabled = busy;

  const grid = document.getElementById('product-buttons');
  if (grid) {
    grid.style.pointerEvents = busy ? 'none' : '';
    grid.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
}

function updateQuantityDisplay() {
  const el = document.getElementById('quantity-display');
  if (el) el.textContent = String(currentQuantity);
}

function generateActionGroupId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return (
    'ag-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8)
  );
}

function initQuantityControls() {
  const undoBtn = document.getElementById('undo-btn');
  if (!undoBtn) return;
  if (document.getElementById('quantity-controls')) return;

  const container = document.createElement('div');
  container.id = 'quantity-controls';
  container.className = 'quantity-controls';
  container.innerHTML = `
    <div class="quantity-label">Aantal:</div>
    <div class="quantity-input">
      <button type="button" class="btn quantity-minus" aria-label="Minder drankjes">-</button>
      <span id="quantity-display" aria-live="polite">1</span>
      <button type="button" class="btn quantity-plus" aria-label="Meer drankjes">+</button>
    </div>
  `;

  // Plaats de teller boven de undo-knop
  undoBtn.parentNode.insertBefore(container, undoBtn);

  const minus = container.querySelector('.quantity-minus');
  const plus = container.querySelector('.quantity-plus');

  if (minus) {
    minus.addEventListener('click', () => {
      if (currentQuantity > MIN_QTY) {
        currentQuantity -= 1;
        updateQuantityDisplay();
      }
    });
  }

  if (plus) {
    plus.addEventListener('click', () => {
      if (currentQuantity < MAX_QTY) {
        currentQuantity += 1;
        updateQuantityDisplay();
      }
    });
  }
}

async function loadUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, "WIcreations"');

  if (error) return console.error(error);

  const sel = $('#user');
  if (!sel) return;

  const coll = new Intl.Collator('nl', { sensitivity: 'base' });
  const sorted = (users || []).slice().sort((a, b) => {
    if (!!a.WIcreations !== !!b.WIcreations) return a.WIcreations ? -1 : 1;
    return coll.compare(a.name, b.name);
  });

  // Echte -regels met value="id"
  const parts = ['-- Kies gebruiker --'];
  let seenSplit = false;
  sorted.forEach((u) => {
    if (!u.WIcreations && !seenSplit) {
      parts.push('────────────');
      seenSplit = true;
    }
    parts.push(`${esc(u.name)}`);
  });

  sel.innerHTML = parts.join('');
}

async function loadProducts() {
  const [{ data: products, error }, { data: batches, error: stockErr }] =
    await Promise.all([
      supabase
        .from('products')
        .select('id, name, price, image_url')
        .order('name', { ascending: true }),
      supabase
        .from('stock_batches')
        .select('product_id, quantity')
        .gt('quantity', 0),
    ]);

  if (error) return console.error(error);
  if (stockErr) return console.error(stockErr);

  const stockMap = new Map();
  (batches || []).forEach((b) => {
    const q = Number(b.quantity) || 0;
    stockMap.set(b.product_id, (stockMap.get(b.product_id) || 0) + q);
  });

  const grid = $('#product-buttons');
  if (!grid) return;
  grid.classList.add('product-grid');
  grid.innerHTML = '';

  const BUCKET_URL =
    'https://stmpommlhkokcjkwivfc.supabase.co/storage/v1/object/public/product-images/';

  (products || [])
    .filter((p) => (stockMap.get(p.id) || 0) > 0)
    .forEach((p) => {
      const wrap = document.createElement('div');
      const btn = document.createElement('button');
      btn.className = 'btn drink-btn';
      btn.type = 'button';

      const imgTag = p.image_url
        ? `<img src="${BUCKET_URL}${encodeURIComponent(
            p.image_url
          )}" alt="${esc(p.name)}" class="drink-img">`
        : '';

      btn.innerHTML = `${imgTag} ${esc(p.name)} ${euro(p.price)} `;

      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          await logDrink(p.id, p.price, currentQuantity); // verkoopprijs + hoeveelheid
        } finally {
          btn.disabled = false;
        }
      });

      wrap.appendChild(btn);
      grid.appendChild(wrap);
    });
}

window.logDrink = async (productId, sellPrice, quantityOverride) => {
  const now = Date.now();
  if (isLogging || now - lastLogAt < THROTTLE_MS) return;
  lastLogAt = now;
  isLogging = true;
  setUiBusy(true);

  let qty = Number(quantityOverride ?? currentQuantity ?? 1);
  if (!Number.isFinite(qty) || qty < MIN_QTY) qty = MIN_QTY;
  if (qty > MAX_QTY) qty = MAX_QTY;

  const userId = $('#user').value;
  if (!userId) {
    setUiBusy(false);
    isLogging = false;
    return toast('⚠️ Kies eerst een gebruiker');
  }

  // 1) Alle batches met voorraad (FIFO)
  const { data: batches, error: obErr } = await supabase
    .from('stock_batches')
    .select('id, quantity, price_per_piece')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at', { ascending: true });

  if (obErr || !batches || !batches.length) {
    setUiBusy(false);
    isLogging = false;
    return toast('❌ Geen voorraad meer voor dit product');
  }

  let totalAvailable = 0;
  for (const b of batches) {
    totalAvailable += Number(b.quantity) || 0;
  }

  if (totalAvailable < qty) {
    setUiBusy(false);
    isLogging = false;
    return toast('❌ Niet genoeg voorraad voor dit aantal');
  }

  // 2) Consumptieplan per batch (FIFO)
  let remaining = qty;
  const plan = [];
  for (const b of batches) {
    const startQty = Number(b.quantity) || 0;
    if (startQty <= 0) continue;
    const use = Math.min(startQty, remaining);
    if (use > 0) {
      plan.push({
        batch_id: b.id,
        count: use,
        price_per_piece: b.price_per_piece,
        startQty,
      });
      remaining -= use;
      if (remaining === 0) break;
    }
  }

  const actionGroupId = generateActionGroupId();

  const rows = [];
  for (const entry of plan) {
    for (let i = 0; i < entry.count; i++) {
      rows.push({
        user_id: userId,
        product_id: productId,
        price_at_purchase: entry.price_per_piece,
        sell_price_at_purchase: sellPrice ?? entry.price_per_piece,
        batch_id: entry.batch_id,
        action_group_id: actionGroupId,
      });
    }
  }

  // 3) Alle drankjes in één keer wegschrijven
  {
    const { error: dErr } = await supabase.from('drinks').insert(rows);
    if (dErr) {
      setUiBusy(false);
      isLogging = false;
      return toast('❌ Fout bij loggen drankje');
    }
  }

  // 4) Alle geraakte batches bijwerken
  for (const entry of plan) {
    const newQty = (Number(entry.startQty) || 0) - entry.count;
    const { error: uErr } = await supabase
      .from('stock_batches')
      .update({ quantity: newQty })
      .eq('id', entry.batch_id);
    if (uErr) {
      setUiBusy(false);
      isLogging = false;
      return toast('❌ Fout bij afboeken voorraad');
    }
  }

  await loadProducts();

  const sel = $('#user');
  if (sel) sel.value = '';

  // teller terug naar 1
  currentQuantity = 1;
  updateQuantityDisplay();

  try {
    toast(qty === 1 ? '✅ Drankje toegevoegd' : `✅ ${qty} drankjes toegevoegd`);
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
  if (isUndoing || now - lastUndoAt < THROTTLE_MS) {
    if (el) el.disabled = false;
    return;
  }
  lastUndoAt = now;
  isUndoing = true;
  setUiBusy(true);

  // laatste drink incl. batch & prijs & action_group_id
  const { data: last, error } = await supabase
    .from('drinks')
    .select('id, user_id, product_id, batch_id, price_at_purchase, action_group_id')
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

  let groupRows = null;

  if (!last.action_group_id) {
    // oude gedrag: 1 record
    const { error: delErr } = await supabase
      .from('drinks')
      .delete()
      .eq('id', last.id);
    if (delErr) {
      setUiBusy(false);
      isUndoing = false;
      if (el) el.disabled = false;
      return toast('❌ Fout bij verwijderen drankje');
    }

    if (last.batch_id) {
      const { data: b, error: bErr } = await supabase
        .from('stock_batches')
        .select('id, quantity')
        .eq('id', last.batch_id)
        .maybeSingle();
      if (!bErr && b) {
        await supabase
          .from('stock_batches')
          .update({ quantity: (Number(b.quantity) || 0) + 1 })
          .eq('id', b.id);
      } else {
        await supabase.from('stock_batches').insert([
          {
            product_id: last.product_id,
            quantity: 1,
            price_per_piece: last.price_at_purchase,
          },
        ]);
      }
    } else {
      await supabase.from('stock_batches').insert([
        {
          product_id: last.product_id,
          quantity: 1,
          price_per_piece: last.price_at_purchase ?? 0,
        },
      ]);
    }
  } else {
    // nieuwe gedrag: hele actie (groep) ongedaan maken
    const { data, error: groupErr } = await supabase
      .from('drinks')
      .select('id, product_id, batch_id, price_at_purchase')
      .eq('action_group_id', last.action_group_id);

    groupRows = data;

    if (groupErr || !groupRows || !groupRows.length) {
      setUiBusy(false);
      isUndoing = false;
      if (el) el.disabled = false;
      return toast('❌ Geen drankje om te verwijderen');
    }

    const { error: delErr } = await supabase
      .from('drinks')
      .delete()
      .eq('action_group_id', last.action_group_id);
    if (delErr) {
      setUiBusy(false);
      isUndoing = false;
      if (el) el.disabled = false;
      return toast('❌ Fout bij verwijderen drankjes');
    }

    for (const row of groupRows) {
      if (row.batch_id) {
        const { data: b, error: bErr } = await supabase
          .from('stock_batches')
          .select('id, quantity')
          .eq('id', row.batch_id)
          .maybeSingle();
        if (!bErr && b) {
          await supabase
            .from('stock_batches')
            .update({ quantity: (Number(b.quantity) || 0) + 1 })
            .eq('id', b.id);
        } else {
          await supabase.from('stock_batches').insert([
            {
              product_id: row.product_id,
              quantity: 1,
              price_per_piece: row.price_at_purchase,
            },
          ]);
        }
      } else {
        await supabase.from('stock_batches').insert([
          {
            product_id: row.product_id,
            quantity: 1,
            price_per_piece: row.price_at_purchase ?? 0,
          },
        ]);
      }
    }
  }

  await loadProducts();

  const undoneCount =
    last.action_group_id && Array.isArray(groupRows) && groupRows.length
      ? groupRows.length
      : 1;

  try {
    toast(
      undoneCount === 1
        ? '⏪ Laatste drankje verwijderd'
        : `⏪ Laatste actie verwijderd (${undoneCount} drankjes)`
    );
    await renderTotalsFromMetrics();
    await renderPivotFromMetrics();
    canUndo = false;
  } finally {
    setUiBusy(false);
    isUndoing = false;
    if (el) el.disabled = false;
  }
};

async function renderTotalsFromMetrics() {
  try {
    $('#totalToPayList').innerHTML = `Laden…`;
    const rows = await fetchUserTotalsCurrentPrice(supabase);
    $('#totalToPayList').innerHTML =
      (rows || [])
        .map((r) => `${esc(r.name)}${euro(r.amount)}`)
        .join('') || `Nog geen data`;
  } catch (e) {
    console.error('renderTotalsFromMetrics:', e);
    $('#totalToPayList').innerHTML = `Kon bedragen niet laden`;
  }
}

async function renderPivotFromMetrics() {
  try {
    const { products, rows } = await fetchUserDrinkPivot(supabase);
    $('#userDrinkTotalsHead').innerHTML = `Gebruiker${products
      .map((p) => `${esc(p)}`)
      .join('')}`;
    $('#userDrinkTotalsBody').innerHTML =
      (rows || [])
        .map(
          (r) =>
            `${esc(r.user)}${r.counts.map((c) => `${c}`).join('')}`
        )
        .join('') || `Nog geen data`;
  } catch (e) {
    console.error('renderPivotFromMetrics:', e);
    $('#userDrinkTotalsHead').innerHTML = '';
    $('#userDrinkTotalsBody').innerHTML = `Kon gegevens niet laden`;
  }
}
