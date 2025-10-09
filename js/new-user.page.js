// === Supabase init (zelfde project/keys als index) ===
const SUPABASE_URL = "https://stmpommlhkokcjkwivfc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0bXBvbW1saGtva2Nqa3dpdmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzODA5MzMsImV4cCI6MjA1Njk1NjkzM30.U7MCLsJdc21aw8dhE9a0nvuuypgBeWL9feAqlaiXqOo";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// === DOM helpers ===
const $  = (sel) => document.querySelector(sel);

document.addEventListener("DOMContentLoaded", async () => {
  $("#nu-submit").addEventListener("click", addUser);
  await loadRecentUsers();
});

async function addUser(){
  const name   = ($("#nu-name").value || "").trim();
  const phone  = ($("#nu-phone").value || "").trim();
  const avatar = ($("#nu-avatar").value || "").trim();

  if(!name) return toast("⚠️ Vul een naam in");
  if(phone && !/^[0-9+() \-]{6,20}$/.test(phone)) return toast("⚠️ Ongeldig telefoonnummer");

  const payload = { name };
  if(phone)  payload.phone  = phone;      // alleen zichtbaar in Admin
  if(avatar) payload.avatar = avatar;     // optioneel: URL

  const { error } = await supabase.from("users").insert([payload]);
  if(error){ console.error(error); return toast("❌ Fout bij toevoegen gebruiker"); }

  $("#nu-name").value = "";
  $("#nu-phone").value = "";
  $("#nu-avatar").value = "";
  toast("✅ Gebruiker toegevoegd");
  await loadRecentUsers();
}

async function loadRecentUsers(){
  const { data, error } = await supabase.from("users")
    .select("name, phone")
    .order("created_at", { ascending:false })
    .limit(20);
  if(error){ console.error(error); return; }

  const rows = (data||[]).map(u => `
    <tr><td>${esc(u.name)}</td><td>${esc(u.phone||"—")}</td></tr>
  `).join("");
  $("#nu-recent").innerHTML = rows;
}

// Utils
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function toast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(), 500); }, 2000);
}
