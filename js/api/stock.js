// /js/api/stock.js
import { $, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

export const DEPOSIT_MAP = { petfles: 0.25, glas: 0.10, blikje: 0.15 };

/* ---------------------------
 * Publieke helpers voor Index
 * --------------------------- */

// Haal producten op + totale voorraad (som van batches)
export async function getProductsWithStock(sb = supabase) {
  const [{ data: prods, error: pErr }, { data: batches, error: bErr }] = await Promise.all([
    sb.from('products').select('id, name, price').order('name', { ascending: true }),
    sb.from('stock_batches').select('product_id, quantity').gt('quantity', 0),
  ]);
  if (pErr) throw pErr;
  if (bErr) throw bErr;

  const stockMap = new Map();
  (batches || []).forEach(b => {
    const k = b.product_id;
    stockMap.set(k, (stockMap.get(k) || 0) + (Number(b.quantity) || 0));
  });

  return (prods || []).map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    stock: stockMap.get(p.id) || 0,
  }));
}

// FIFO verbruik: trek qty af uit oudste batches
export async function fifoConsume(productId, qty = 1, sb = supabase) {
  let remaining = Number(qty) || 0;
  if (remaining <= 0) return true;

  const { data: batches, error } = await sb
    .from('stock_batches')
    .select('id, quantity')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error(error);
    return false;
  }

  for (const b of (batches || [])) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    if (take <= 0) continue;

    const { error: updErr } = await sb
      .from('stock_batches')
      .update({ quantity: b.quantity - take })
      .eq('id', b.id);

    if (updErr) {
      console.error(updErr);
      return false;
    }

    remaining -= take;
  }

  // true ook als voorraad niet genoeg was, maar signaleren we met remaining
  return remaining === 0;
}

// FIFO terugboeken: voeg qty toe, beginnend bij jongste batch
export async function fifoUnconsume(productId, qty = 1, sb = supabase) {
  let remaining = Number(qty) || 0;
  if (remaining <= 0) return true;

  const { data: batches, error } = await sb
    .from('stock_batches')
    .select('id, quantity')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    console.error(error);
    return false;
  }

  for (const b of (batches || [])) {
    if (remaining <= 0) break;
    const add = Math.min(remaining, 999999); // onbeperkt toevoegen aan jongste batch
    const { error: updErr } = await sb
      .from('stock_batches')
      .update({ quantity: (Number(b.quantity) || 0) + add })
      .eq('id', b.id);
    if (updErr) {
      console.error(updErr);
      return false;
    }
    remaining -= add;
  }

  // Als er geen batches zijn, zouden we er eigenlijk één moeten maken; V1 deed dat niet → laten we het stilzwijgend negeren.
  return true;
}

// Sync verkoopprijs naar prijs van oudste batch
export async function syncProductPriceFromOldestBatch(productId, sb = supabase) {
  const { data: batches, error } = await sb
    .from('stock_batches')
    .select('price_per_piece, created_at')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  if ((batches || []).length > 0) {
    const newPrice = Math.max(0, batches[0].price_per_piece || 0);
    await sb.from('products').update({ price: newPrice }).eq('id', productId);
  }
}

/* ---------------------------------
 * UI helpers (Stock pagina zelf)
 * --------------------------------- */

export async function loadProducts(){
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) {
    console.error(error);
    return toast('❌ Kon producten niet laden');
  }

  const opts = [
    '<option value="">— Kies product —</option>',
    ...(products || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
  ].join('');
  $('#batch-product').innerHTML = opts;
}

export function showCalcHint(){
  const qty = parseInt($('#batch-qty').value, 10);
  const total = parseFloat(($('#batch-total').value || '0').replace(',', '.'));
  const depType = $('#batch-deposit-type').value || '';
  const depVal = DEPOSIT_MAP[depType] || 0;

  if (qty > 0 && total >= 0) {
    const base = total / qty;
    const piece = Math.max(0, base + depVal);
    $('#calc-hint').textContent =
      `Indicatie verkoopprijs/stuk: ${euro(piece)} ` +
      `(basis €${base.toFixed(2).replace('.', ',')} + statiegeld ` +
      `€${depVal.toFixed(2).replace('.', ',')})`;
  } else {
    $('#calc-hint').textContent = '';
  }
}

export async function addBatch(){
  const productId = $('#batch-product').value;
  const qty = parseInt($('#batch-qty').value, 10);
  const total = parseFloat(($('#batch-total').value || '0').replace(',', '.'));
  const depType = $('#batch-deposit-type').value || '';
  const depVal = DEPOSIT_MAP[depType] || 0;

  if (!productId)  return toast('⚠️ Kies een product');
  if (!(qty > 0))  return toast('⚠️ Vul een geldig aantal in');
  if (!(total >= 0)) return toast('⚠️ Vul een geldige totaalprijs in');

  const pricePerPiece = Math.max(0, (total / qty) + depVal);

  const payload = {
    product_id: productId,
    quantity: qty,
    price_per_piece: round2(pricePerPiece),
    deposit_type: depType || null,
    deposit_value: depVal || 0
  };

  const { error } = await supabase.from('stock_batches').insert([payload]);
  if (error) {
    console.error(error);
    return toast('❌ Fout bij toevoegen batch');
  }

  toast('✅ Batch toegevoegd');
  $('#batch-product').value = '';
  $('#batch-qty').value = '';
  $('#batch-total').value = '';
  $('#batch-deposit-type').value = '';
  $('#calc-hint').textContent = '';

  await refreshTables();
  await syncProductPriceFromOldestBatch(productId);
}

export async function refreshTables(){
  await loadActiveBatches();
  await loadStockPerProduct();
}

export async function loadActiveBatches(){
  const { data, error } = await supabase
    .from('stock_batches')
    .select('id, product_id, quantity, price_per_piece, deposit_type, deposit_value, created_at, products(name)')
    .gt('quantity', 0)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error(error);
    return toast('❌ Kon batches niet laden');
  }

  const rows = (data || []).map(b => `
    <tr>
      <td>${esc(b.products?.name || 'Onbekend')}</td>
      <td>${esc(formatDate(b.created_at))}</td>
      <td class="right">${b.quantity}</td>
      <td class="right">${euro(b.price_per_piece)}</td>
      <td>${b.deposit_type ? `${esc(b.deposit_type)} (${euro(b.deposit_value || 0)})` : '—'}</td>
      <td>
        <button class="btn delete-btn" onclick="deleteBatch('${esc(b.id)}','${esc(b.product_id)}')">Verwijderen</button>
      </td>
    </tr>
  `).join('');

  $('#tbl-batches').innerHTML = rows;
}

export async function loadStockPerProduct(){
  const { data, error } = await supabase
    .from('stock_batches')
    .select('product_id, quantity, products(name)')
    .gt('quantity', 0);

  if (error) {
    console.error(error);
    return toast('❌ Kon voorraad niet laden');
  }

  const map = {};
  (data || []).forEach(r => {
    const key = r.product_id;
    map[key] = map[key] || { name: r.products?.name || 'Onbekend', qty: 0 };
    map[key].qty += r.quantity || 0;
  });

  const rows = Object.values(map)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(x => `<tr><td>${esc(x.name)}</td><td class="right">${x.qty}</td></tr>`)
    .join('');

  $('#tbl-stock-per-product').innerHTML = rows;
}

export async function deleteBatch(id, productId){
  if (!confirm('Weet je zeker dat je deze batch wilt verwijderen?')) return;

  const { error } = await supabase
    .from('stock_batches')
    .delete()
    .eq('id', id);

  if (error) {
    console.error(error);
    return toast('❌ Verwijderen mislukt');
  }

  toast('✅ Batch verwijderd');
  await refreshTables();
  await syncProductPriceFromOldestBatch(productId);
}

function round2(v){
  return Math.round((Number(v) || 0) * 100) / 100;
}
