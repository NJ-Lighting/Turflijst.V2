// /js/pages/stock.page.js
import { $, $$, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import {
  DEPOSIT_MAP,
  loadProducts,
  showCalcHint,
  addBatch,
  refreshTables,
  deleteBatch as apiDeleteBatch,
  syncProductPriceFromOldestBatch,
} from '../api/stock.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadProducts();
    await refreshTables();
  } catch (e) {
    console.error(e);
    toast('❌ Fout bij laden voorraad');
  }

  // Batch invoer events
  $('#btn-add-batch')?.addEventListener('click', addBatch);
  $('#batch-total')?.addEventListener('input', showCalcHint);
  $('#batch-qty')?.addEventListener('input', showCalcHint);
  $('#batch-deposit-type')?.addEventListener('change', showCalcHint);
});

/* ---------- Acties op batches ---------- */

// Inline vanuit tabel
window.deleteBatch = async (id, productId) => {
  await apiDeleteBatch(id, productId);
};

// Hoeveelheid aanpassen (prompt)
window.editBatchQty = async (batchId, productId, currentQty = 0) => {
  const v = prompt('Nieuwe hoeveelheid voor deze batch:', String(currentQty ?? 0));
  if (v == null) return; // cancel
  const qty = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(qty) || qty < 0) return toast('⚠️ Ongeldige hoeveelheid');

  const { error } = await supabase
    .from('stock_batches')
    .update({ quantity: Math.floor(qty) })
    .eq('id', batchId);

  if (error) {
    console.error(error);
    return toast('❌ Aanpassen mislukt');
  }

  // FIFO-prijs sync (oudste batch bepaalt prijs)
  await syncProductPriceFromOldestBatch(productId);

  toast('✅ Hoeveelheid aangepast');
  await refreshTables();
};
