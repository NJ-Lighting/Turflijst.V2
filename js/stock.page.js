// === Supabase init (zelfde project/keys als index) ===
const SUPABASE_URL = "https://stmpommlhkokcjkwivfc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0bXBvbW1saGtva2Nqa3dpdmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzODA5MzMsImV4cCI6MjA1Njk1NjkzM30.U7MCLsJdc21aw8dhE9a0nvuuypgBeWL9feAqlaiXqOo";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// === DOM helpers ===
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// === Constants ===
const DEPOSIT_MAP = {
  "petfles": 0.25,
  "glas": 0.10,
  "blikje": 0.15
};

// === Lifecycle ===
document.addEventListener("DOMContentLoaded", async () => {
  await loadProducts();
  await refreshTables();

  // events
  $("#btn-add-batch").addEventListener("click", addBatch);
  $("#batch-total").addEventListener("input", showCalcHint);
  $("#batch-qty").addEventListener("input", showCalcHint);
  $("#batch-deposit-type").addEventListener("change", showCalcHint);
});

// === Product dropdown ===
async function loadProducts(){
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name")
    .order("name", { ascending:true });

  if(error){ console.error(error); return; }

  const opts = [`<option value="">— Kies product —</option>`]
    .concat((products||[]).map(p => `<option value="${p.id}">${esc(p.name)}</option>`))
    .join("");

  $("#batch-product").innerHTML = opts;
}

// === Hint prijsberekening ===
function showCalcHint(){
  const qty = parseInt($("#batch-qty").value, 10);
  const total = parseFloat(($("#batch-total").value || "0").replace(",", "."));
  const depType = $("#batch-deposit-type").value || "";
  const depVal = DEPOSIT_MAP[depType] || 0;

  if(qty > 0 && total >= 0){
    const base = total / qty;
    const piece = base + depVal;
    $("#calc-hint").textContent = `Indicatie verkoopprijs/stuk: ${euro(piece)} (basis €${base.toFixed(2).replace(".", ",")} + statiegeld €${depVal.toFixed(2).replace(".", ",")})`;
  }else{
    $("#calc-hint").textContent = "";
  }
}

// === Nieuwe batch toevoegen ===
async function addBatch(){
  const productId = $("#batch-product").value;
  const qty = parseInt($("#batch-qty").value, 10);
  const total = parseFloat(($("#batch-total").value || "0").replace(",", "."));
  const depType = $("#batch-deposit-type").value || "";
  const depVal = DEPOSIT_MAP[depType] || 0;

  if(!productId) return toast("⚠️ Kies een product");
  if(!(qty > 0)) return toast("⚠️ Vul een geldig aantal in");
  if(!(total >= 0)) return toast("⚠️ Vul een geldige totaalprijs in");

  const pricePerPiece = (total / qty) + depVal;

  // Optioneel: batch_date server-side default NOW()
  const payload = {
    product_id: productId,
    quantity: qty,
    price_per_piece: round2(pricePerPiece),
    deposit_type: depType || null,   // text kolom
    deposit_value: depVal || 0,      // numeric kolom
    // buffer_used: 0,                // voeg toe als je kolom hebt
  };

  const { error } = await supabase.from("stock_batches").insert([payload]);
  if(error){ console.error(error); return toast("❌ Fout bij toevoegen batch"); }

  toast("✅ Batch toegevoegd");
  $("#batch-product").value = "";
  $("#batch-qty").value = "";
  $("#batch-total").value = "";
  $("#batch-deposit-type").value = "";
  $("#calc-hint").textContent = "";

  await refreshTables();

  // Belangrijk: update products-prijs naar FIFO (oudste batch)
  await updateProductsPriceFromFIFO(productId);
}

// === Batches + Voorraad tabellen ===
async function refreshTables(){
  await loadActiveBatches();
  await loadStockPerProduct();
}

async function loadActiveBatches(){
  const { data, error } = await supabase
    .from("stock_batches")
    .select("id, product_id, quantity, price_per_piece, deposit_type, deposit_value, buffer_used, batch_date, products(name)")
    .gt("quantity", 0)
    .order("batch_date", { ascending: true })
    .order("id", { ascending: true }); // fallback

  if(error){ console.error(error); return; }

  const rows = (data||[]).map(b => `
    <tr>
      <td>${esc(b.products?.name || "Onbekend")}</td>
      <td>${formatDate(b.batch_date)}</td>
      <td>${b.quantity}</td>
      <td>${euro(b.price_per_piece)}</td>
      <td>${formatDeposit(b.deposit_type, b.deposit_value)}</td>
      <td>${b.buffer_used != null ? euro(b.buffer_used) : "—"}</td>
      <td>
        <button class="btn btn-warn" onclick="deleteBatch('${b.id}', '${b.product_id}')">🗑️ Verwijderen</button>
      </td>
    </tr>
  `).join("");

  $("#tbl-batches").innerHTML = rows;
}

async function loadStockPerProduct(){
  // som quantities per product_id
  const { data, error } = await supabase
    .from("stock_batches")
    .select("product_id, quantity, products(name)")
    .gt("quantity", 0);

  if(error){ console.error(error); return; }

  const map = {};
  (data||[]).forEach(r => {
    const key = r.product_id;
    map[key] = map[key] || { name: r.products?.name || "Onbekend", qty: 0 };
    map[key].qty += r.quantity || 0;
  });

  const rows = Object.values(map)
    .sort((a,b)=> a.name.localeCompare(b.name))
    .map(x => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td></tr>`)
    .join("");

  $("#tbl-stock-per-product").innerHTML = rows;
}

// === Batch verwijderen ===
async function deleteBatch(id, productId){
  if(!confirm("Weet je zeker dat je deze batch wilt verwijderen?")) return;
  const { error } = await supabase.from("stock_batches").delete().eq("id", id);
  if(error){ console.error(error); return toast("❌ Verwijderen mislukt"); }
  toast("✅ Batch verwijderd");
  await refreshTables();
  await updateProductsPriceFromFIFO(productId);
}

// === FIFO: update products.price vanuit oudste batch ===
async function updateProductsPriceFromFIFO(productId){
  const { data: batches, error } = await supabase
    .from("stock_batches")
    .select("price_per_piece")
    .eq("product_id", productId)
    .gt("quantity", 0)
    .order("batch_date", { ascending: true })
    .order("id", { ascending: true });

  if(error){ console.error(error); return; }

  if((batches||[]).length > 0){
    const newPrice = batches[0].price_per_piece || 0;
    await supabase.from("products").update({ price: newPrice }).eq("id", productId);
  }
}

// === Helpers ===
function euro(v){ return `€${round2(v).toFixed(2).replace('.', ',')}`; }
function round2(v){ return Math.round((Number(v)||0) * 100) / 100; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function formatDate(iso){
  if(!iso) return "—";
  try{ return new Date(iso).toLocaleString('nl-NL'); }catch{ return iso; }
}
function formatDeposit(type, val){
  if(!type) return "—";
  return `${type} (${euro(val)})`;
}
function toast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(), 500); }, 2000);
}

// Expose for inline onclick
window.deleteBatch = deleteBatch;
