// type: module
import { $, $$, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import {
  DEPOSIT_MAP,
  loadProducts,
  showCalcHint,
  addBatch,
  refreshTables,
  deleteBatch as apiDeleteBatch
} from '../api/stock.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadProducts();
    await refreshTables();
  } catch (e) {
    console.error(e);
    toast('❌ Fout bij laden voorraad');
  }
  $('#btn-add-batch')?.addEventListener('click', addBatch);
  $('#batch-total')?.addEventListener('input', showCalcHint);
  $('#batch-qty')?.addEventListener('input', showCalcHint);
  $('#batch-deposit-type')?.addEventListener('change', showCalcHint);
});

// Expose voor inline onclick (als je HTML dat nu gebruikt)
window.deleteBatch = (id, productId) => apiDeleteBatch(id, productId);
