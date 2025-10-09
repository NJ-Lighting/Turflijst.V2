// Supabase init
let supabase;
let lastLoggedDrinkId = null;

const SUPABASE_URL = "https://stmpommlhkokcjkwivfc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0bXBvbW1saGtva2Nqa3dpdmZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzODA5MzMsImV4cCI6MjA1Njk1NjkzM30.U7MCLsJdc21aw8dhE9a0nvuuypgBeWL9feAqlaiXqOo";
const BUCKET_URL = "https://stmpommlhkokcjkwivfc.supabase.co/storage/v1/object/public/product-images/";

document.addEventListener("DOMContentLoaded", async () => {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  await loadUsers();
  await loadProducts();
  await loadTotalToPay();
  await loadUserDrinkTotals();
});

async function loadUsers() {
  const userSelect = document.getElementById("user");
  userSelect.innerHTML = '<option value="">-- Kies gebruiker --</option>';

  const { data: users, error } = await supabase
    .from("users")
    .select("id, name, WIcreations");

  if (error) { console.error("Kon users niet laden:", error); return; }

  const sorted = users.slice().sort((a, b) => {
    if (a.WIcreations !== b.WIcreations) return a.WIcreations ? -1 : 1;
    return a.name.localeCompare(b.name, "nl", { sensitivity: "base" });
  });

  let html = '<option value="">-- Kies gebruiker --</option>';
  let hadWIcreations = false;

  sorted.forEach((u, idx) => {
    if (!u.WIcreations && !hadWIcreations && idx > 0) {
      html += `<option disabled>────────────</option>`;
      hadWIcreations = true;
    }
    html += `<option value="${u.id}">${u.name}</option>`;
  });

  userSelect.innerHTML = html;
}

async function loadProducts() {
  let { data: products, error } = await supabase.from("products").select("*");
  if (error) return console.error("Error loading products:", error);

  let { data: stock, error: stockError } = await supabase
    .from("stock_batches")
    .select("product_id, quantity")
    .gt("quantity", 0);
  if (stockError) return console.error("Error loading stock:", stockError);

  const stockMap = {};
  (stock || []).forEach(b => { stockMap[b.product_id] = (stockMap[b.product_id] || 0) + (b.quantity || 0); });

  const container = document.getElementById("product-buttons");
  container.innerHTML = "";

  const gridWrapper = document.createElement("div");
  gridWrapper.className = "product-grid-inner";

  (products || []).forEach(p => {
    const voorraad = stockMap[p.id] || 0;
    if (voorraad === 0) return;

    const imageUrl = p.image_url ? `${BUCKET_URL}${p.image_url}` : "";

    const button = document.createElement("button");
    button.className = "drink-btn";
    button.onclick = () => logDrink(p.id);
    button.innerHTML = `
      ${imageUrl ? `<img src="${imageUrl}" alt="${p.name}" />` : ""}
      <div class="text-wrapper">
        <div>${p.name}</div>
        <div>€${p.price.toFixed(2).replace(".", ",")}</div>
      </div>
    `;
    gridWrapper.appendChild(button);
  });

  // wrapper in outer container
  const outer = document.createElement("div");
  outer.style.display = "grid";
  outer.style.gridTemplateColumns = "repeat(auto-fill, minmax(200px, 1fr))";
  outer.style.gap = "20px";
  outer.style.width = "100%";
  outer.style.maxWidth = "600px";
  outer.style.margin = "0 auto";
  while (gridWrapper.firstChild) outer.appendChild(gridWrapper.firstChild);
  container.appendChild(outer);
}

async function logDrink(product_id) {
  const user_id = document.getElementById("user").value;
  if (!user_id) return showToast("⚠️ Kies eerst een gebruiker!");

  const { data, error } = await supabase.from("drinks").insert([{ user_id, product_id }]).select();
  if (error) return alert("Fout bij loggen drankje: " + error.message);
  if (data?.length > 0) lastLoggedDrinkId = data[0].id;

  const { data: batches, error: batchError } = await supabase
    .from("stock_batches")
    .select("*")
    .eq("product_id", product_id)
    .gt("quantity", 0)
    .order("created_at", { ascending: true });

  if (!batchError && (batches||[]).length > 0) {
    await updateProductPriceFromOldestBatch(product_id);
    let remaining = 1;
    for (const batch of batches) {
      if (batch.quantity >= remaining) {
        await supabase.from("stock_batches").update({ quantity: batch.quantity - remaining }).eq("id", batch.id);
        break;
      } else {
        remaining -= batch.quantity;
        await supabase.from("stock_batches").update({ quantity: 0 }).eq("id", batch.id);
      }
    }
  }

  showToast("✅ Drankje toegevoegd!");
  await loadTotalToPay();
  await loadUserDrinkTotals();
  document.getElementById("user").value = "";
}

async function updateProductPriceFromOldestBatch(productId) {
  const { data: batches, error } = await supabase
    .from("stock_batches")
    .select("*")
    .eq("product_id", productId)
    .gt("quantity", 0)
    .order("created_at", { ascending: true });

  if (!error && (batches||[]).length > 0) {
    const newPrice = batches[0].price_per_piece;
    await supabase.from("products").update({ price: newPrice }).eq("id", productId);
    await loadProducts();
  }
}

async function undoLastDrink() {
  if (!lastLoggedDrinkId) return showToast("⚠️ Geen drankje om ongedaan te maken!");
  await supabase.from("drinks").delete().eq("id", lastLoggedDrinkId);
  showToast("🔄 Laatste drankje verwijderd!");
  lastLoggedDrinkId = null;
  await loadTotalToPay();
  await loadUserDrinkTotals();
  await loadProducts();
}

async function loadTotalToPay() {
  const { data: totals } = await supabase.from("drinks").select("user_id, users(name), products(price)");
  const totalByUser = {};
  (totals||[]).forEach(drink => {
    const name = drink.users?.name || "Onbekend";
    const price = drink.products?.price || 0;
    totalByUser[name] = (totalByUser[name] || 0) + price;
  });
  const sorted = Object.entries(totalByUser).sort((a,b)=> a[0].localeCompare(b[0]));
  document.getElementById("totalToPayList").innerHTML = sorted
    .map(([name, amount]) => `<tr><td>${name}</td><td>€${amount.toFixed(2).replace('.', ',')}</td></tr>`)
    .join("");
}

async function loadUserDrinkTotals() {
  const { data: drinks } = await supabase.from("drinks").select("user_id, users(name), products(name)");
  const users = {};
  const drinkNames = new Set();
  (drinks||[]).forEach(drink => {
    const name = drink.users?.name || "Onbekend";
    const drinkName = drink.products?.name || "Onbekend";
    users[name] = users[name] || {};
    users[name][drinkName] = (users[name][drinkName] || 0) + 1;
    drinkNames.add(drinkName);
  });
  const headers = [...drinkNames].sort();
  const headerRow = `<tr><th>Gebruiker</th>${headers.map(d=>`<th>${d}</th>`).join('')}</tr>`;
  const rows = Object.entries(users)
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([user, ds]) => `<tr><td>${user}</td>${headers.map(d=>`<td>${ds[d]||0}</td>`).join('')}</tr>`)
    .join("");
  document.getElementById("userDrinkTotalsTable").innerHTML = headerRow + rows;
}

function showToast(msg){
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(()=>{ toast.style.opacity="0"; setTimeout(()=>toast.remove(), 500); }, 2000);
}

window.checkAdminPin = function(){
  const pin = prompt("Voer de admin pincode in:");
  if (pin === "1915") { location.href = "/admin.html"; }
  else if (pin !== null) { alert("❌ Onjuiste pincode"); }
};
window.undoLastDrink = undoLastDrink; // voor onclick in HTML
