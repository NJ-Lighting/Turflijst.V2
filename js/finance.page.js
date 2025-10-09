// === Supabase init (zelfde project/keys als index) ===
const SUPABASE_URL = "https://stmpommlhkokcjkwivfc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0bXBvbW1saGtva2Nqa3dpdmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzODA5MzMsImV4cCI6MjA1Njk1NjkzM30.U7MCLsJdc21aw8dhE9a0nvuuypgBeWL9feAqlaiXqOo";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// === DOM helpers ===
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// === Lifecycle ===
document.addEventListener("DOMContentLoaded", async () => {
  await loadUsersToSelects();
  await loadKPIs();
  await loadSoldPerProduct();
  await loadPayments();

  // events
  $("#btn-add-payment").addEventListener("click", addPayment);
  $("#filter-user").addEventListener("change", () => loadPayments());
});

// === Users in dropdowns ===
async function loadUsersToSelects(){
  const { data: users, error } = await supabase.from("users").select("id, name").order("name", { ascending:true });
  if(error){ console.error(error); return; }

  const opts = [`<option value="">— Alle gebruikers —</option>`]
    .concat((users||[]).map(u => `<option value="${u.id}">${u.name}</option>`)).join("");

  $("#filter-user").innerHTML = opts;

  const optsPay = [`<option value="">— Kies gebruiker —</option>`]
    .concat((users||[]).map(u => `<option value="${u.id}">${u.name}</option>`)).join("");

  $("#pay-user").innerHTML = optsPay;
}

// === KPI's ===
// - Totale voorgeschoten bedrag: som van alle nog niet-betaalde consumpties (indicatief: som products.price uit drinks)
// - Totale waarde in koelkast: som(stock_batches.quantity * price_per_piece)
// - Statiegeld in omloop: placeholder (pas aan naar jouw deposits/buffer schema)
async function loadKPIs(){
  // 1) Voorgeschoten (drinks * actuele productprijs)
  const { data: d } = await supabase.from("drinks").select("products(price)").returns(Array);
  const advanced = (d||[]).reduce((sum, row) => sum + (row?.products?.price || 0), 0);

  // 2) Koelkastwaarde (stock_batches * price_per_piece)
  const { data: sb } = await supabase.from("stock_batches").select("quantity, price_per_piece").gt("quantity", 0);
  const fridge = (sb||[]).reduce((sum, b) => sum + (b.quantity * (b.price_per_piece || 0)), 0);

  // 3) Statiegeld in omloop (placeholder → zet hier jouw echte berekening neer)
  //    Bijvoorbeeld: totale statiegeld-ontvangsten - buffer_used
  let depositCirculation = 0;
  // const { data: dep } = await supabase.from("deposits").select("amount");
  // const { data: buf } = await supabase.from("stock_batches").select("buffer_used");
  // depositCirculation = sum(dep.amount) - sum(buf.buffer_used);

  $("#kpi-advanced").textContent = euro(advanced);
  $("#kpi-fridge").textContent = euro(fridge);
  $("#kpi-deposit-circulation").textContent = euro(depositCirculation);
}

// === Verkochte aantallen per product ===
async function loadSoldPerProduct(){
  // drinks join products → tel per productnaam
  const { data, error } = await supabase.from("drinks").select("products(name)").returns(Array);
  if(error){ console.error(error); return; }

  const counts = {};
  (data||[]).forEach(r => {
    const name = r?.products?.name || "Onbekend";
    counts[name] = (counts[name] || 0) + 1;
  });

  const rows = Object.entries(counts)
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([name, n]) => `<tr><td>${esc(name)}</td><td>${n}</td></tr>`).join("");

  $("#tbl-sold-per-product").innerHTML = rows;
}

// === Betalingen (lijst + filter) ===
async function loadPayments(){
  const userId = $("#filter-user").value;

  let query = supabase.from("payments").select("id, amount, created_at, users(name)");
  if(userId) query = query.eq("user_id", userId);
  query = query.order("created_at", { ascending:false }).limit(200);

  const { data, error } = await query;
  if(error){ console.error(error); return; }

  const rows = (data||[]).map(p => {
    const dt = formatDate(p.created_at);
    const user = p?.users?.name || "Onbekend";
    return `<tr><td>${dt}</td><td>${esc(user)}</td><td>${euro(p.amount||0)}</td></tr>`;
  }).join("");

  $("#tbl-payments").innerHTML = rows;
}

// === Betaling registreren ===
async function addPayment(){
  const userId = $("#pay-user").value;
  const amountStr = $("#pay-amount").value.trim();

  if(!userId) return toast("⚠️ Kies eerst een gebruiker");
  const amount = parseFloat(amountStr.replace(",", "."));
  if(!(amount > 0)) return toast("⚠️ Vul een geldig bedrag in");

  // Idempotentie optioneel: ext_ref (bijv. timestamp+user)
  const extRef = `v2pay-${userId}-${Date.now()}`;

  const { error } = await supabase.from("payments")
    .insert([{ user_id: userId, amount, ext_ref: extRef }]);

  if(error){
    console.error(error);
    toast("❌ Fout bij registreren betaling");
    return;
  }

  toast("✅ Betaling geregistreerd");
  $("#pay-amount").value = "";
  await loadPayments();
  await loadKPIs();
}

// === Utils ===
function euro(v){ return `€${(v||0).toFixed(2).replace('.', ',')}`; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function formatDate(iso){ try{ return new Date(iso).toLocaleString('nl-NL'); }catch{ return iso||''; } }

function toast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(), 500); }, 2000);
}
