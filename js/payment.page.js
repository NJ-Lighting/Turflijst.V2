// === Supabase init (zelfde project/keys als index) ===
const SUPABASE_URL = "https://stmpommlhkokcjkwivfc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0bXBvbW1saGtva2Nqa3dpdmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzODA5MzMsImV4cCI6MjA1Njk1NjkzM30.U7MCLsJdc21aw8dhE9a0nvuuypgBeWL9feAqlaiXqOo";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// === DOM helpers ===
const $  = (sel) => document.querySelector(sel);

// === Lifecycle ===
document.addEventListener("DOMContentLoaded", async () => {
  await loadUsers();
  await loadPayments();

  $("#p-add").addEventListener("click", addPayment);
  $("#p-filter-user").addEventListener("change", loadPayments);
});

// === Users in dropdowns ===
async function loadUsers(){
  const { data: users, error } = await supabase
    .from("users")
    .select("id, name")
    .order("name", { ascending: true });

  if(error){ console.error(error); return; }

  const optsAll = [`<option value="">— Alle gebruikers —</option>`]
    .concat((users||[]).map(u => `<option value="${u.id}">${esc(u.name)}</option>`))
    .join("");
  $("#p-filter-user").innerHTML = optsAll;

  const optsPick = [`<option value="">— Kies gebruiker —</option>`]
    .concat((users||[]).map(u => `<option value="${u.id}">${esc(u.name)}</option>`))
    .join("");
  $("#p-user").innerHTML = optsPick;
}

// === Betaling registreren ===
async function addPayment(){
  const userId = $("#p-user").value;
  const amountStr = $("#p-amount").value.trim();
  const note = $("#p-note").value.trim();

  if(!userId) return toast("⚠️ Kies eerst een gebruiker");
  const amount = parseFloat(amountStr.replace(",", "."));
  if(!(amount > 0)) return toast("⚠️ Vul een geldig bedrag in");

  // Idempotent: unieke referentie (kan later vervangen worden door echte payment-id)
  const extRef = `v2pay-${userId}-${Date.now()}`;

  const payload = { user_id: userId, amount, ext_ref: extRef };
  if(note) payload.note = note; // voeg 'note' kolom toe in je payments schema indien nog niet aanwezig

  const { error } = await supabase.from("payments").insert([payload]);
  if(error){
    console.error(error);
    return toast("❌ Fout bij registreren betaling");
  }

  toast("✅ Betaling geregistreerd");
  $("#p-amount").value = "";
  $("#p-note").value = "";
  await loadPayments();
}

// === Betalingen laden (met filter) ===
async function loadPayments(){
  const filterUser = $("#p-filter-user").value;

  let q = supabase.from("payments")
    .select("id, amount, note, created_at, users(name)")
    .order("created_at", { ascending: false })
    .limit(300);

  if(filterUser) q = q.eq("user_id", filterUser);

  const { data, error } = await q;
  if(error){ console.error(error); return; }

  const rows = (data||[]).map(p => {
    const dt = new Date(p.created_at).toLocaleString("nl-NL");
    const user = p?.users?.name || "Onbekend";
    const note = p?.note || "—";
    const amount = euro(p.amount || 0);
    return `
      <tr>
        <td>${dt}</td>
        <td>${esc(user)}</td>
        <td>${amount}</td>
        <td>${esc(note)}</td>
        <td>
          <button class="btn btn-warn" onclick="deletePayment('${p.id}')">🗑️ Verwijderen</button>
        </td>
      </tr>`;
  }).join("");

  $("#p-rows").innerHTML = rows;
}

// === Verwijderen (handig voor testdata) ===
async function deletePayment(id){
  if(!confirm("Weet je zeker dat je deze betaling wilt verwijderen?")) return;
  const { error } = await supabase.from("payments").delete().eq("id", id);
  if(error){ console.error(error); return toast("❌ Verwijderen mislukt"); }
  toast("✅ Betaling verwijderd");
  await loadPayments();
}

// === Utils ===
function euro(v){ return `€${(v||0).toFixed(2).replace('.', ',')}`; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function toast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(), 500); }, 2000);
}

// Expose for inline onclick
window.deletePayment = deletePayment;
