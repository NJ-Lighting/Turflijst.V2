// === Supabase init (zelfde project/keys als index) ===
const SUPABASE_URL = "https://stmpommlhkokcjkwivfc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0bXBvbW1saGtva2Nqa3dpdmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzODA5MzMsImV4cCI6MjA1Njk1NjkzM30.U7MCLsJdc21aw8dhE9a0nvuuypgBeWL9feAqlaiXqOo";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// === DOM helpers ===
const $  = (sel) => document.querySelector(sel);

// === Lifecycle ===
document.addEventListener("DOMContentLoaded", async () => {
  await loadUsers();
  setDefaultDates();
  $("#h-apply").addEventListener("click", loadHistory);
  await loadHistory();
});

async function loadUsers(){
  const { data: users, error } = await supabase.from("users").select("id, name").order("name", { ascending:true });
  if(error){ console.error(error); return; }
  const opts = [`<option value="">— Alle gebruikers —</option>`]
    .concat((users||[]).map(u => `<option value="${u.id}">${esc(u.name)}</option>`)).join("");
  $("#h-user").innerHTML = opts;
}

function setDefaultDates(){
  // Standaard: laatste 30 dagen
  const to   = new Date();
  const from = new Date(Date.now() - 29*864e5);
  $("#h-from").value = toDateInput(from);
  $("#h-to").value   = toDateInput(to);
}

async function loadHistory(){
  const userId = $("#h-user").value;
  const from   = $("#h-from").value ? new Date($("#h-from").value) : null;
  const to     = $("#h-to").value   ? new Date($("#h-to").value)   : null;

  let query = supabase.from("drinks")
    .select("created_at, users(name), products(name, price)")
    .order("created_at", { ascending:false })
    .limit(500);

  if(userId) query = query.eq("user_id", userId);
  // Date filter clientside (simpele variant) – kan ook via RPC of .gte/.lte als je kolom typen checkt
  const { data, error } = await query;
  if(error){ console.error(error); return; }

  const rows = [];
  let sum = 0;

  (data||[])
    .filter(r => {
      const t = new Date(r.created_at);
      const inFrom = from ? t >= truncDay(from) : true;
      const inTo   = to   ? t <= endOfDay(to)   : true;
      return inFrom && inTo;
    })
    .forEach(r => {
      const dt = new Date(r.created_at).toLocaleString('nl-NL');
      const user = r?.users?.name || "Onbekend";
      const prod = r?.products?.name || "—";
      const price = r?.products?.price || 0;
      sum += price;
      rows.push(`<tr><td>${dt}</td><td>${esc(user)}</td><td>${esc(prod)}</td><td>${euro(price)}</td></tr>`);
    });

  $("#h-rows").innerHTML = rows.join("");
  $("#h-sum").textContent = euro(sum);
}

// === Utils ===
function truncDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function toDateInput(d){ return d.toISOString().slice(0,10); }
function euro(v){ return `€${(v||0).toFixed(2).replace('.', ',')}`; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
