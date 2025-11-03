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

  // Zorg dat de invoervelden dezelfde styling/UX hebben als V1
  applyV1StyleToNewBatchInputs();
});

/** Geef de "Nieuwe batch" velden de V1-styling en UX-hints. */
function applyV1StyleToNewBatchInputs(){
  const $p = $('#batch-product');
  const $q = $('#batch-qty');
  const $t = $('#batch-total');
  const $d = $('#batch-deposit-type');

  // 1) Zelfde look als V1: .select class + centrale look uit app.css
  [$p, $q, $t, $d].forEach(el => el && el.classList.add('select'));

  // 2) UX + validatie zoals in V1 gewend
  if ($q) {
    $q.setAttribute('type', 'number');
    $q.setAttribute('min', '1');
    if (!$q.getAttribute('placeholder')) $q.setAttribute('placeholder', 'Aantal');
  }
  if ($t) {
    $t.setAttribute('type', 'number');
    $t.setAttribute('step', '0.01');
    $t.setAttribute('inputmode', 'decimal');
    $t.setAttribute('min', '0');
    if (!$t.getAttribute('placeholder')) $t.setAttribute('placeholder', 'Totaalprijs (excl. statiegeld)');
  }
  if ($p && !$p.getAttribute('aria-label')) $p.setAttribute('aria-label', 'Kies product');
  if ($d && !$d.getAttribute('aria-label')) $d.setAttribute('aria-label', 'Soort statiegeld');

  // 3) Placeholder-opties in de selects (alleen als ze nog ontbreken)
  if ($p && !$p.querySelector('option[disabled][value=""]')) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— Kies product —';
    opt.disabled = true;
    opt.selected = !$p.value;
    $p.prepend(opt);
  }
  if ($d && !$d.querySelector('option[disabled][value=""]')) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '— Statiegeldtype —';
    opt.disabled = true;
    opt.selected = !$d.value;
    $d.prepend(opt);
  }
}

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
