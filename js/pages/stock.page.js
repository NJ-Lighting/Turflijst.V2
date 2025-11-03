// /js/pages/stock.page.js
import { $, $$, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

// ---------- State ----------
let availableProducts = [];
let depositBuffer = 0;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadProducts();
    await fetchDepositBuffer();
    await loadStock();
  } catch (e) {
    console.error(e);
    toast('❌ Fout bij laden voorraad');
  }
  $('#addRowBtn')?.addEventListener('click', addProductRow);
  $('#addBatchBtn')?.addEventListener('click', addBatch);
});

/* ---------- V1: Nieuwe batch invoer ---------- */
function escAttr(s){ return String(s==null?'':s).replace(/"/g,'&quot;'); }

async function loadProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id,name')
    .order('name', { ascending: true });
  if (error) { console.error(error); return toast('❌ Fout bij laden producten'); }
  availableProducts = data || [];
  $('#batchForm').innerHTML = '';
  addProductRow();
}

function addProductRow(){
  const container = $('#batchForm');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'product-row';

  const select = document.createElement('select');
  select.innerHTML = '<option value="">-- Kies product --</option>' +
    (availableProducts||[]).map(p => `<option value="${escAttr(p.id)}">${escAttr(p.name || ('#'+p.id))}</option>`).join('');

  const price = document.createElement('input');
  price.type = 'number'; price.step = '0.01'; price.placeholder = 'Inkoopprijs (€)';

  const qty = document.createElement('input');
  qty.type = 'number'; qty.min = '1'; qty.placeholder = 'Aantal';

  const dep = document.createElement('select');
  dep.innerHTML = [
    '<option value="none,0">Geen statiegeld</option>',
    '<option value="petfles,0.25">Petfles (€0,25)</option>',
    '<option value="glas,0.10">Glas (€0,10)</option>',
    '<option value="blikje,0.15">Blikje (€0,15)</option>',
  ].join('');

  const del = document.createElement('button');
  del.textContent = '❌';
  del.type = 'button';
  del.className = 'delete-btn';
  del.addEventListener('click', () => {
    if (container.querySelectorAll('.product-row').length > 1) row.remove();
  });

  row.append(select, price, qty, dep, del);
  container.appendChild(row);
}

function formatEUR(n){ return Number(n||0).toLocaleString('nl-NL',{style:'currency',currency:'EUR'}); }

async function fetchDepositBuffer(){
  const deps = await supabase.from('deposits').select('amount');
  const bufs = await supabase.from('stock_batches').select('buffer_used');
  const totalIn = (deps.data||[]).reduce((s,d)=> s + Number(d.amount||0), 0);
  const totalOut = (bufs.data||[]).reduce((s,b)=> s + Number(b.buffer_used||0), 0);
  depositBuffer = Math.max(0, Number((totalIn - totalOut).toFixed(2)));
  $('#bufferAmount').textContent = formatEUR(depositBuffer);
}

async function addBatch(){
  const rows = Array.from(document.querySelectorAll('#batchForm .product-row'));
  const mode = $('#bufferMode')?.value || 'none';
  const items = [];
  let totalCount = 0;

  for (const r of rows){
    const product_id = r.querySelector('select')?.value;
    const price = parseFloat((r.querySelector('input[placeholder^="Inkoopprijs"]')?.value || '').replace(',', '.'));
    const quantity = parseInt(r.querySelector('input[placeholder="Aantal"]')?.value || '0', 10);
    const depVal = (r.querySelectorAll('select')[1]?.value || 'none,0').split(',');
    const depositType = depVal[0];
    const deposit_value = parseFloat(depVal[1] || '0');
    if (!product_id || !(quantity>0) || !(price>=0)) continue;
    const deposit_type = (depositType==='none') ? null : depositType;
    const pricePerUnit = Number(((price/quantity) + deposit_value).toFixed(2));
    items.push({ product_id, quantity, deposit_type, deposit_value, pricePerUnit });
    totalCount += quantity;
  }
  if (!items.length) return toast('⚠️ Voer minstens 1 geldige regel in');

  let bufferUsed = 0;
  const inserts = [];
  for (const item of items){
    let korting = 0;
    if (mode!=='none' && depositBuffer>0 && item.deposit_value>0){
      const maxKorting = item.quantity * item.deposit_value;
      if (mode==='full'){
        const factor = totalCount>0 ? (item.quantity/totalCount) : 0;
        korting = Math.min(depositBuffer * factor, maxKorting);
      } else if (mode==='partial'){
        korting = Math.min(depositBuffer, maxKorting); // greedy per regel
      }
    }
    korting = Number(korting.toFixed(2));
    const perPieceDiscount = (item.quantity>0) ? (korting/item.quantity) : 0;
    let adjusted = Number((item.pricePerUnit - perPieceDiscount).toFixed(2));
    if (adjusted < 0) adjusted = 0;
    inserts.push({
      product_id: item.product_id,
      quantity: item.quantity,
      price_per_piece: adjusted,
      deposit_type: item.deposit_type,
      deposit_value: item.deposit_value,
      buffer_used: korting
    });
    bufferUsed += korting;
  }

  try{
    for (const ins of inserts){
      const { error } = await supabase.from('stock_batches').insert(ins);
      if (error) throw error;
      await updateProductPriceFromOldestBatch(ins.product_id); // FIFO
    }
    toast(`✅ Batch toegevoegd. Verbruikte buffer: ${formatEUR(bufferUsed)}`);
    $('#batchForm').innerHTML = '';
    addProductRow();
    await fetchDepositBuffer();
    await loadStock();
  }catch(e){
    console.error(e);
    toast('❌ Fout bij batch toevoegen');
  }
}

async function updateProductPriceFromOldestBatch(productId){
  const q = await supabase
    .from('stock_batches')
    .select('price_per_piece, quantity, created_at')
    .eq('product_id', productId)
    .gt('quantity', 0)
    .order('created_at', { ascending: true });
  if (q.error) return;
  const data = q.data || [];
  if (!data.length) return;
  const newPrice = Number(data[0].price_per_piece||0);
  await supabase.from('products').update({ price: newPrice }).eq('id', productId);
}

/* ---------- V1: Huidige Voorraad ---------- */
async function loadStock(){
  const q = await supabase
    .from('stock_batches')
    .select('id, quantity, price_per_piece, deposit_type, deposit_value, buffer_used, products(name), product_id, created_at')
    .order('created_at', { ascending: true });
  const batches = q.data || [];
  const grouped = {}; // name -> { total, batches: [] }
  batches.forEach(b => {
    const qty = Number(b.quantity||0);
    if (qty <= 0) return;
    const name = b.products?.name || 'Onbekend';
    if (!grouped[name]) grouped[name] = { total: 0, batches: [] };
    grouped[name].total += qty;
    grouped[name].batches.push(b);
  });
  const tbody = $('#stockTable');
  const names = Object.keys(grouped);
  if (!names.length){
    tbody.innerHTML = '<tr><td colspan="8">Geen voorraad</td></tr>';
    return;
  }
  let html = '';
  names.sort().forEach(name => {
    const obj = grouped[name];
    for (const b of obj.batches){
      const depTxt = b.deposit_type ? `${esc(b.deposit_type)} (${formatEUR(Number(b.deposit_value||0))})` : '–';
      const bufTxt = b.buffer_used ? formatEUR(Number(b.buffer_used||0)) : '–';
      html += `
        <tr>
          <td>${esc(name)}</td>
          <td>${formatEUR(Number(b.price_per_piece||0))}</td>
          <td>${Number(b.quantity||0)}</td>
          <td>${obj.total}</td>
          <td>${depTxt}</td>
          <td>${new Date(b.created_at).toLocaleDateString('nl-NL')}</td>
          <td>${bufTxt}</td>
          <td>
            <input type="number" min="0" value="${Number(b.quantity||0)}"
              onchange="updateBatch('${escAttr(b.id)}', ${Number(b.quantity||0)}, this.value, '${escAttr(b.product_id)}')"
              style="width:120px;background:#222;color:#fff;border:1px solid #4CAF50;border-radius:8px;padding:8px;text-align:center">
            <button class="delete-btn small" onclick="deleteBatch('${escAttr(b.id)}', '${escAttr(b.product_id)}')">❌</button>
          </td>
        </tr>`;
    }
  });
  tbody.innerHTML = html;
}

// Exposed voor inline handlers
window.updateBatch = async (id, oldQty, newQty, productId) => {
  const qty = parseInt(newQty, 10);
  if (isNaN(qty) || qty < 0) { return alert('Ongeldige hoeveelheid'); }
  if (Number(qty) === Number(oldQty)) return;
  const up = await supabase.from('stock_batches').update({ quantity: qty }).eq('id', id);
  if (up.error) { return alert('Fout bij updaten: ' + up.error.message); }
  await updateProductPriceFromOldestBatch(productId);
  await loadStock();
};

window.deleteBatch = async (id, productId) => {
  if (!confirm('Weet je zeker dat je deze batch wilt verwijderen?')) return;
  const del = await supabase.from('stock_batches').delete().eq('id', id);
  if (del.error) { return alert('Fout bij verwijderen: ' + del.error.message); }
  await updateProductPriceFromOldestBatch(productId);
  await loadStock();
};
