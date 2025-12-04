// /js/pages/payment.page.js
import { $, euro, esc, toast } from "../core.js";
import { supabase } from "../supabase.client.js";

let GLOBAL_PAYLINK = null;
let PAYMENT_FLAGS = new Map();
let ADMIN_MODE = false;

/* ---------------------------------------------------------
   INIT
--------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  await loadGlobalPayLink();
  await loadPaymentFlags();
  await renderOpenBalances();

  $("#pb-search")?.addEventListener("input", renderOpenBalances);
  $("#pb-admin")?.addEventListener("click", toggleAdminMode);
});

/* ---------------------------------------------------------
   SALDI BEREKENEN
--------------------------------------------------------- */
async function computeOpenBalances(searchTerm = "") {
  const { data: users } = await supabase
    .from("users")
    .select("id, name")
    .order("name", { ascending: true });

  const { data: rows } = await supabase
    .from("drinks")
    .select("user_id, price_at_purchase, products(price)");

  const sumByUser = new Map();
  const countByUser = new Map();

  (rows || []).forEach((r) => {
    const price = Number(r?.price_at_purchase ?? r?.products?.price ?? 0);
    const uid = r.user_id;
    sumByUser.set(uid, (sumByUser.get(uid) || 0) + price);
    countByUser.set(uid, (countByUser.get(uid) || 0) + 1);
  });

  const q = (searchTerm || "").trim().toLowerCase();

  return (users || [])
    .map((u) => ({
      id: u.id,
      name: u.name,
      amount: sumByUser.get(u.id) || 0,
      count: countByUser.get(u.id) || 0,
    }))
    .filter((u) => !q || u.name.toLowerCase().includes(q))
    .filter((u) => u.amount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------
   TABEL RENDEREN
--------------------------------------------------------- */
async function renderOpenBalances() {
  const search = $("#pb-search")?.value || "";
  let list = [];

  try {
    list = await computeOpenBalances(search);
  } catch (err) {
    console.error(err);
    return toast("❌ Kan openstaande saldi niet berekenen");
  }

  const rowsHtml = list
    .map((u) => {
      const uid = esc(u.id);
      const name = esc(u.name);
      const count = String(u.count);
      const amount = euro(Number(u.amount) || 0);

      const attemptISO = PAYMENT_FLAGS.get(u.id) || null;
      const attemptText = attemptISO
        ? new Date(attemptISO).toLocaleString("nl-NL")
        : null;

      // Poging + kruisje in admin-modus
      const attemptCell = attemptISO
        ? `${attemptText} ${
            ADMIN_MODE
              ? `<button class="btn pb-admin-clear" data-id="${uid}">❌</button>`
              : ""
          }`
        : "—";

      // Betalen-knop
      const btnPay = `
        <button class="btn pb-pay"
          data-id="${uid}"
          data-name="${esc(u.name)}"
          data-amount="${u.amount}">
          Betalen
        </button>
      `;

      // Admin extra knoppen
      let adminExtra = "";
      if (ADMIN_MODE) {
        adminExtra += `
          <button class="btn pb-admin-paid" data-id="${uid}">
            Betaald
          </button>
        `;

        adminExtra += `
          <button class="btn pb-admin-wa"
            data-name="${esc(u.name)}"
            data-link="${GLOBAL_PAYLINK || ""}">
            Whatsapp
          </button>
        `;
      }

      return `
        <tr>
          <td>${name}</td>
          <td>${count}</td>
          <td>${amount}</td>
          <td>${attemptCell}</td>
          <td>${btnPay}${adminExtra}</td>
        </tr>
      `;
    })
    .join("");

  $("#pb-rows").innerHTML = rowsHtml;

  /* ---------------------------------------------------------
     EVENTS BINDEN
  --------------------------------------------------------- */

  // Betalen
  document.querySelectorAll(".pb-pay").forEach((btn) => {
    btn.addEventListener("click", () => {
      pbPayto(btn, btn.dataset.id, btn.dataset.name, btn.dataset.amount);
    });
  });

  // Admin: Betaald
  document.querySelectorAll(".pb-admin-paid").forEach((btn) => {
    btn.addEventListener("click", () => pbMarkPaid(btn.dataset.id));
  });

  // Admin: Whatsapp
  document.querySelectorAll(".pb-admin-wa").forEach((btn) => {
    btn.addEventListener("click", () => {
      const msg = `Hola!!!
Het is heus het is waar, het moment is daar. 
Bij deze het betaalverzoek voor de drankjes uit de WI-koelkast, bij 40-45.

${btn.dataset.link}

Alvast bedankt!!
Nick Jonker`;

      window.open(
        `https://wa.me/?text=${encodeURIComponent(msg)}`,
        "_blank"
      );
    });
  });

  // Admin: Flag verwijderen
  document.querySelectorAll(".pb-admin-clear").forEach((btn) => {
    btn.addEventListener("click", () => pbClearFlag(btn.dataset.id));
  });
}

/* ---------------------------------------------------------
   ADMIN MODUS
--------------------------------------------------------- */
function toggleAdminMode() {
  const pin = prompt("Voer admin-PIN in:");
  if (pin !== "0000") return toast("❌ Onjuiste PIN");

  ADMIN_MODE = !ADMIN_MODE;
  renderOpenBalances();
}

/* ---------------------------------------------------------
   ADMIN: BETAALD
--------------------------------------------------------- */
window.pbMarkPaid = async (userId) => {
  const balances = await computeOpenBalances("");
  const entry = balances.find((b) => b.id == userId);
  const amount = entry?.amount || 0;

  if (!(amount > 0)) return toast("Geen openstaand saldo");

  await supabase.from("payments").insert([{ user_id: userId, amount }]);
  await supabase.from("drinks").delete().eq("user_id", userId);
  await supabase.from("payment_flags").delete().eq("user_id", userId);

  toast(`✅ Betaald: ${amount}`);

  await loadPaymentFlags();
  renderOpenBalances();
};

/* ---------------------------------------------------------
   BETAALLINK LADEN
--------------------------------------------------------- */
async function loadGlobalPayLink() {
  try {
    const { data } = await supabase
      .from("view_payment_link_latest")
      .select("link")
      .maybeSingle();
    GLOBAL_PAYLINK = data?.link || null;
  } catch {
    GLOBAL_PAYLINK = null;
  }
}

/* ---------------------------------------------------------
   BETALEN (met iPhone-fix)
--------------------------------------------------------- */
window.pbPayto = async (btn, userId, name, amount) => {
  if (!GLOBAL_PAYLINK) return toast("⚠️ Geen open betaallink ingesteld");

  let win = null;

  // iPhone fix: popup moet direct op klik openen
  try {
    win = window.open("", "_blank", "noopener,noreferrer");
  } catch {}

  await flagPaymentAttempt(userId);
  await loadPaymentFlags();
  await renderOpenBalances();

  if (win) win.location.href = GLOBAL_PAYLINK;
  else window.location.href = GLOBAL_PAYLINK;
};

/* ---------------------------------------------------------
   FLAG FUNCTIES
--------------------------------------------------------- */
async function flagPaymentAttempt(userId) {
  const ts = new Date().toISOString();
  PAYMENT_FLAGS.set(userId, ts);

  await supabase.from("payment_flags").upsert(
    { user_id: userId, attempted_at: ts },
    { onConflict: "user_id" }
  );
}

async function loadPaymentFlags() {
  PAYMENT_FLAGS.clear();

  const { data } = await supabase
    .from("payment_flags")
    .select("user_id, attempted_at");

  for (const r of data || []) PAYMENT_FLAGS.set(r.user_id, r.attempted_at);
}

window.pbClearFlag = async (userId) => {
  await supabase.from("payment_flags").delete().eq("user_id", userId);

  toast("❌ Flag verwijderd");

  await loadPaymentFlags();
  renderOpenBalances();
};
