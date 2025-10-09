// === Supabase init ===
const SUPABASE_URL = "https://stmpommlhkokcjkwivfc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0bXBvbW1saGtva2Nqa3dpdmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzODA5MzMsImV4cCI6MjA1Njk1NjkzM30.U7MCLsJdc21aw8dhE9a0nvuuypgBeWL9feAqlaiXqOo";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// === DOM helpers ===
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// === Lifecycle ===
document.addEventListener("DOMContentLoaded", async () => {
  await loadUsers();
  await loadProducts();

  $("#btn-add-product").addEventListener("click", addProduct);
});

// === Gebruikersbeheer ===
async function loadUsers(){
  const { data: users, error } = await supabase.from("users")
    .select("id, name, drinks(products(price)), payments(amount)")
    .order("name", { ascending:true });
  if(error){ console.error(error); return; }

  const rows = (users||[]).map(u => {
    // totaalbedrag berekenen (drinks - payments)
    const totalDrinks = (u.drinks||[]).reduce((sum, d)=> sum + (d.products?.price||0), 0);
    const totalPayments = (u.payments||[]).reduce((sum, p)=> sum + (p.amount||0), 0);
    const balance = totalDrinks - totalPayments;

    return `
      <tr>
        <td>${esc(u.name)}</td>
        <td>${euro(balance)}</td>
        <td>${(u.drinks||[]).length}</td>
        <td>
          <button class="btn ghost" onclick="resetUser('${u.id}')">🧾 Nulzetten</button>
          <button class="btn btn-warn" onclick="deleteUser('${u.id}')">❌ Verwijderen</button>
        </td>
      </tr>`;
  }).join("");

  $("#tbl-users").innerHTML = rows;
}

async function resetUser(id){
  if(!confirm("Weet je zeker dat je deze gebruiker wilt nulzetten?")) return;
  // Reset saldo → alle drinks verwijderen
  const { error } = await supabase.from("drinks").delete().eq("user_id", id);
  if(error){ toast("❌ Fout bij resetten gebruiker"); return; }
  toast("✅ Gebruiker gereset");
  await loadUsers();
}

async function deleteUser(id){
  if(!confirm("Weet je zeker dat je deze gebruiker definitief wilt verwijderen?")) return;
  await supabase.from("payments").delete().eq("user_id", id);
  await supabase.from("drinks").delete().eq("user_id", id);
  const { error } = await supabase.from("users").delete().eq("id", id);
  if(error){ toast("❌ Fout bij verwijderen gebruiker"); return; }
  toast("✅ Gebruiker verwijderd");
  await loadUsers();
}

// === Productbeheer ===
async function loadProducts(){
  const { data: products, error } = await supabase.from("products").select("*").order("name", { ascending:true });
  if(error){ console.error(error); return; }

  const rows = (products||[]).map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${euro(p.price)}</td>
      <td>
        <button class="btn ghost" onclick="editProduct('${p.id}', '${esc(p.name)}', ${p.price})">✏️ Bewerken</button>
        <button class="btn btn-warn" onclick="deleteProduct('${p.id}')">🗑️ Verwijderen</button>
      </td>
    </tr>`).join("");

  $("#tbl-products").innerHTML = rows;
}

async function addProduct(){
  const name = $("#new-product-name").value.trim();
  const price = parseFloat($("#new-product-price").value.replace(",", "."));
  if(!name || !(price >= 0)) return toast("⚠️ Vul naam en prijs in");

  const { error } = await supabase.from("products").insert([{ name, price }]);
  if(error){ toast("❌ Fout bij toevoegen product"); return; }

  $("#new-product-name").value = "";
  $("#new-product-price").value = "";
  toast("✅ Product toegevoegd");
  await loadProducts();
}

async function editProduct(id, oldName, oldPrice){
  const newName = prompt("Nieuwe productnaam:", oldName);
  if(newName === null) return;
  const newPriceStr = prompt("Nieuwe prijs (€):", oldPrice.toFixed(2).replace(".", ","));
  if(newPriceStr === null) return;
  const newPrice = parseFloat(newPriceStr.replace(",", "."));
  if(isNaN(newPrice)) return toast("⚠️ Ongeldige prijs");

  const { error } = await supabase.from("products").update({ name:newName, price:newPrice }).eq("id", id);
  if(error){ toast("❌ Fout bij bijwerken product"); return; }
  toast("✅ Product bijgewerkt");
  await loadProducts();
}

async function deleteProduct(id){
  if(!confirm("Weet je zeker dat je dit product wilt verwijderen?")) return;
  const { error } = await supabase.from("products").delete().eq("id", id);
  if(error){ toast("❌ Fout bij verwijderen product"); return; }
  toast("✅ Product verwijderd");
  await loadProducts();
}

// === Helpers ===
function euro(v){ return `€${(v||0).toFixed(2).replace('.', ',')}`; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function toast(msg){
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(), 500); }, 2000);
}

// Expose helpers for inline onclick calls
window.resetUser = resetUser;
window.deleteUser = deleteUser;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
