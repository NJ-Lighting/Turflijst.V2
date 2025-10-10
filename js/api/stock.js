// js/api/stock.js
// Voorraad/FIFO & prijs-synchronisatie + (optioneel) drink-log hulpmiddelen

import { supabase } from '../supabase.client.js';
import { invalidateFinanceCache } from './finance.js';

/**
 * consumeProduct
 * Trekt voorraad af via FIFO (oudste batches eerst).
 * - Past GEEN drinks/consumptie toe (dat kan apart met logDrink()).
 * - Na afloop: synchroniseert products.price naar prijs van oudste batch (>0) voor consistentie met retail-prijs.
 */
export async function consumeProduct(productId, qty = 1) {
  if (!productId || qty <= 0) return;

  // 1) Batches ophalen (oudste eerst), alleen met quantity > 0
  const { data: batches, error: eFetch } = await supabase
    .from('stock_batches')
    .select('id, quantity, batch_date')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('batch_date', { ascending: true });

  if (eFetch) throw new Error(`stock_batches fetch: ${eFetch.message}`);

  let remaining = qty;
  for (const b of batches || []) {
    if (remaining <= 0) break;
    const take = Math.min(Number(b.quantity || 0), remaining);
    if (take <= 0) continue;

    const { error: eUpd } = await supabase
      .from('stock_batches')
      .update({ quantity: Number(b.quantity) - take })
      .eq('id', b.id);

    if (eUpd) throw new Error(`stock_batches update: ${eUpd.message}`);
    remaining -= take;
  }

  // 2) Als batches zijn aangepast → sync products.price (oudste batch >0)
  await syncProductPriceFromOldestBatch(productId);

  // 3) Cache invalideren
  invalidateFinanceCache();
}

/**
 * syncProductPriceFromOldestBatch
 * Zet products.price gelijk aan price_per_piece van de oudste batch met quantity > 0.
 * (Zodat retail-waarde en knoppenprijzen automatisch meeschakelen met FIFO)
 */
export async function syncProductPriceFromOldestBatch(productId) {
  if (!productId) return;

  const { data: batches, error } = await supabase
    .from('stock_batches')
    .select('price_per_piece, quantity, batch_date')
    .eq('product_id', productId)
    .order('batch_date', { ascending: true });

  if (error) throw new Error(`stock_batches fetch for price sync: ${error.message}`);

  const oldest = (batches || []).find((b) => Number(b.quantity || 0) > 0);
  if (!oldest) return;

  const { error: eUpd } = await supabase
    .from('products')
    .update({ price: Number(oldest.price_per_piece || 0) })
    .eq('id', productId);

  if (eUpd) throw new Error(`products price sync: ${eUpd.message}`);
}

/**
 * logDrink
 * Handige helper om een consumptie te registreren en direct voorraad te verlagen.
 * - Maakt een record in 'drinks'
 * - Roept daarna consumeProduct(productId, 1)
 * - Invalideert de finance-cache
 */
export async function logDrink(userId, productId) {
  if (!userId || !productId) throw new Error('logDrink: userId en productId zijn verplicht');

  const { error: eIns } = await supabase
    .from('drinks')
    .insert([{ user_id: userId, product_id: productId }]); // created_at = default now()

  if (eIns) throw new Error(`drinks insert: ${eIns.message}`);

  await consumeProduct(productId, 1);
  invalidateFinanceCache();
}

/**
 * addBatch
 * (optioneel) Voorraad toevoegen als batch; retourneert nieuw batch-id.
 * - Verwacht prijs_per_piece inclusief statiegeld (volgens jouw pagina’s)
 * - buffer_used kan 0 zijn of een berekend deel uit een statiegeldbuffer
 */
export async function addBatch({
  product_id,
  quantity,
  price_per_piece,
  deposit_type = null,
  deposit_value = null,
  batch_date = new Date().toISOString(),
  buffer_used = 0,
  batch_group_id = null,
}) {
  if (!product_id || !quantity || !price_per_piece) {
    throw new Error('addBatch: product_id, quantity en price_per_piece zijn verplicht');
  }

  const { data, error } = await supabase
    .from('stock_batches')
    .insert([
      {
        product_id,
        quantity: Number(quantity),
        price_per_piece: Number(price_per_piece),
        deposit_type,
        deposit_value: deposit_value != null ? Number(deposit_value) : null,
        batch_date,
        buffer_used: Number(buffer_used || 0),
        batch_group_id,
      },
    ])
    .select('id')
    .single();

  if (error) throw new Error(`stock_batches insert: ${error.message}`);

  // Na toevoegen: sync price (oudste batch >0 kan ongewijzigd blijven, maar bij lege voorraad is dit relevant)
  await syncProductPriceFromOldestBatch(product_id);
  invalidateFinanceCache();
  return data?.id || null;
}

/**
 * removeEmptyBatches
 * (optioneel) Opruimen van batches met quantity <= 0 (functionele keuze, niet verplicht).
 */
export async function removeEmptyBatches(productId) {
  const q = supabase.from('stock_batches').delete().lte('quantity', 0);
  const { error } = productId ? await q.eq('product_id', productId) : await q;
  if (error) throw new Error(`removeEmptyBatches: ${error.message}`);
  invalidateFinanceCache();
}
