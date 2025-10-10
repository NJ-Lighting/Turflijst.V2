// === Turf Lijst – Index Pagina ===
// Gebruikt Supabase client uit /js/supabase.client.js

import { supabase } from "../supabase.client.js";
import { loadMetrics } from "../api/metrics.js";
import { updateProductPriceFromOldestBatch } from "../api/stock.js";

let lastLoggedDrinkId = null;

/* ---------- Helpers ---------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showToast(msg, color = "#4CAF50") {
  const toast = document.createElement("div");
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "30px",
    left: "50%",
    transform: "translateX(-50%)",
    background: color,
    color: "white",
    padding: "12px 20px",
    borderRadius: "10px",
    fontSize: "18px",
    zIndex: "1000",
    transition: "opacity 0.5s",
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 500);
  }, 2000);
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  await loadUsers();
  await loadProducts();
  await loadTotalToPay();
  await loadUserDrinkTotals();
});

/* ---------- Loaders ---------- */
async function loadUsers() {
  const sel = $("#user");
  if (!sel) return;
  sel.innerHTML = `<option value="">-- Kies gebruiker --</option>`;

  const { data: users, error } = await supabase
    .from("users")
    .select("id, name, WIcreations");

  if (error) {
    console.error("Kon users niet laden:", error);
    return;
  }

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

  sel.innerHTML = html;
}

async function loadProducts() {
  const container = $("#product-buttons");
  if (!container) return;

  let { data: products, error } = await supabase.from("products").select("*");
  if (error) return console.error("Error loading products:", error);

  // Haal voorraad per product op
  const { data: stock, error: stockErr } = await supabase
    .from("stock_batches")
    .select("product_id, quantity")
    .gt("quantity", 0);
  if (stockErr) return console.error("Error loading stock:", stockErr);

  const stockMap = {};
  stock.forEach(b => {
    stockMap[b.product_id] = (stockMap[b.product_id] || 0) + b.quantity;
  });

  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(180px, 1fr))";
  grid.style.gap = "12px";

  products.forEach(p => {
    const voorraad = stockMap[p.id] || 0;
    if (voorraad <= 0) return;

    const btn = document.createElement("button");
    btn.className = "btn drink-btn";
    btn.onclick = () => logDrink(p.id);
    const imgUrl = p.image_url
      ? `https://stmpommlhkokcjkwivfc.supabase.co/storage/v1/object/public/product-images/${p.image_url}`
      : "";
    btn.innerHTML = `
      ${imgUrl ? `<img src="${imgUrl}" alt="${p.name}" style="height:40px;width:40px;object-fit:contain;margin-right:8px;border-radius:5px;">` : ""}
      <div style="text-align:left">
        <div>${p.name}</div>
        <div>€${p.price?.toFixed(2).replace(".", ",")}</div>
      </div>
    `;
    grid.appendChild(btn);
  });

  container.appendChild(grid);
}

async function logDrink(product_id) {
  const user_id = $("#user")?.value;
  if (!user_id) return showToast("⚠️ Kies eerst een gebruiker!", "#f59e0b");

  const { data, error } = await supabase.from("drinks").insert([{ user_id, product_id }]).select();
  if (error) return showToast("❌ Fout bij loggen drankje", "#ef4444");
  if (data?.length > 0) lastLoggedDrinkId = data[0].id;

  // FIFO voorraadafboeking
  const { data: batches, error: batchErr } = await supabase
    .from("stock_batches")
    .select("*")
    .eq("product_id", product_id)
    .gt("quantity", 0)
    .order("created_at", { ascending: true });

  if (!batchErr && batches?.length) {
    await updateProductPriceFromOldestBatch(product_id);
    let remaining = 1;
    for (const b of batches) {
      if (b.quantity >= remaining) {
        await supabase.from("stock_batches").update({ quantity: b.quantity - remaining }).eq("id", b.id);
        break;
      } else {
        remaining -= b.quantity;
        await supabase.from("stock_batches").update({ quantity: 0 }).eq("id", b.id);
      }
    }
  }

  showToast("✅ Drankje toegevoegd!");
  await loadTotalToPay();
  await loadUserDrinkTotals();
  await loadProducts();
}

async function undoLastDrink() {
  if (!lastLoggedDrinkId) return showToast("⚠️ Geen drankje om ongedaan te maken!", "#f59e0b");
  await supabase.from("drinks").delete().eq("id", lastLoggedDrinkId);
  showToast("🔄 Laatste drankje verwijderd!");
  lastLoggedDrinkId = null;
  await loadTotalToPay();
  await loadUserDrinkTotals();
  await loadProducts();
}

async function loadTotalToPay() {
  const { data: totals, error } = await supabase
    .from("drinks")
    .select("user_id, users(name), products(price)");
  if (error) return console.error("loadTotalToPay:", error);

  const totalByUser = {};
  totals.forEach(drink => {
    const name = drink.users?.name || "Onbekend";
    const price = drink.products?.price || 0;
    totalByUser[name] = (totalByUser[name] || 0) + price;
  });

  const sorted = Object.entries(totalByUser).sort((a, b) =>
    a[0].localeCompare(b[0], "nl", { sensitivity: "base" })
  );

  $("#totalToPayList").innerHTML = sorted
    .map(([name, amount]) =>
      `<tr><td>${name}</td><td class="right">€${amount.toFixed(2).replace(".", ",")}</td></tr>`
    )
    .join("");
}

/* ---------- Nieuwe pivot-versie: één kolom per drankje ---------- */
async function loadUserDrinkTotals() {
  const headEl = document.getElementById("userDrinkTotalsHead");
  const bodyEl = document.getElementById("userDrinkTotalsBody");
  if (!headEl || !bodyEl) return;

  const { data: rows, error } = await supabase
    .from("drinks")
    .select("user_id, users(name), products(name)");
  if (error) {
    console.error("loadUserDrinkTotals error:", error);
    headEl.innerHTML = "";
    bodyEl.innerHTML = `<tr><td class="muted">Kon gegevens niet laden</td></tr>`;
    return;
  }

  // Bouw matrix gebruiker × product
  const usersMap = new Map(); // name -> Map(product -> count)
  const productSet = new Set();
  for (const r of rows || []) {
    const user = r?.users?.name || "Onbekend";
    const prod = r?.products?.name || "Onbekend";
    productSet.add(prod);
    if (!usersMap.has(user)) usersMap.set(user, new Map());
    const m = usersMap.get(user);
    m.set(prod, (m.get(prod) || 0) + 1);
  }

  const coll = new Intl.Collator("nl", { sensitivity: "base", numeric: true });
  const products = Array.from(productSet).sort(coll.compare);
  const users = Array.from(usersMap.keys()).sort(coll.compare);

  headEl.innerHTML = `<tr><th>Gebruiker</th>${products
    .map(p => `<th class="right">${p}</th>`)
    .join("")}</tr>`;

  if (!users.length) {
    bodyEl.innerHTML = `<tr><td colspan="${1 + products.length}" class="muted">Nog geen data</td></tr>`;
    return;
  }

  bodyEl.innerHTML = users
    .map(u => {
      const m = usersMap.get(u);
      const tds = products
        .map(p => `<td class="right">${m.get(p) || 0}</td>`)
        .join("");
      return `<tr><td>${u}</td>${tds}</tr>`;
    })
    .join("");
}

/* ---------- Export (indien nodig in module) ---------- */
export {
  loadUsers,
  loadProducts,
  logDrink,
  undoLastDrink,
  loadTotalToPay,
  loadUserDrinkTotals,
};
