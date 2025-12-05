// /js/pages/payment.page.js
import { $, euro, esc, toast } from "../core.js";
import { supabase } from "../supabase.client.js";
import { openPaymentWindow } from "../payments/open-payment.js";

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
   INTERNATIONAAL TELEFOONNUMMER NORMALISEREN
--------------------------------------------------------- */
function normalizePhoneInternational(num) {
  if (!num) return null;

  num = num.replace(/[^0-9]/g, "");

  // Nederland
  if (num.startsWith("06")) return "316" + num.slice(2);
  if (num.startsWith("00316")) return "316" + num.slice(5);
  if (num.startsWith("31") && num.length >= 10) return num;

  // België
  if (num.startsWith("04") && num.length === 10) return "324" + num.slice(2);
  if (num.startsWith("00324")) return "324" + num.slice(5);
  if (num.startsWith("32") && num.length >= 10) return num;

  // fallback
  return num;
}

/* ---------------------------------------------------------
   WHATSAPP BERICHT MET PAYMENT PAGINA-LINK
--------------------------------------------------------- */
function createWhatsappMessage() {
  const paymentURL = `${window.location.origin}/payment.html`;

  return `Hola!!!
Het is heus het is waar, het moment is daar. 
Bij deze het betaalverzoek voor de drankjes uit de WI-koelkast, bij 40-45.

${paymentURL}

Alvast bedankt!!
Nick Jonker`;
}

/* ---------------------------------------------------------
   WHATSAPP OPENEN NAAR USER
--------------------------------------------------------- */
function openWhatsappToUser(phone) {
  const normalized = normalizePhoneInternational(phone);

  if (!normalized) {
    alert("⚠️ Geen geldig telefoonnummer bij deze gebruiker");
    return;
  }

  const msg = createWhatsappMessage();
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(msg)}`;

  window.open(url, "_blank");
}

/* ---------------------------------------------------------
   SALDI BEREKENEN
--------------------------------------------------------- */
async function computeOpenBalances(searchTerm = "") {
  const { data: users } = await supabase
    .from("users")
    .select("id, name, phone")
    .order("name", { ascending: true });

  const { data: rows } = await supabase
    .from("drinks")
    .select("user_id, price_at_purchase, products(price)");

  const sum = new Map();
  const cnt = new Map();

  (rows || []).forEach((r) => {
    const price = Number(r?.price_at_purchase ?? r?.products?.price ?? 0);
    sum.set(r.user_id, (sum.get(r.user_id) || 0) + price);
    cnt.set(r.user_id, (cnt.get(r.user_id) || 0) + 1);
  });

  const q = searchTerm.trim().toLowerCase();

  return (users || [])
    .map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      amount: sum.get(u.id) || 0,
      count: cnt.get(u.id) || 0,
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
  const list = await computeOpenBalances(search);

  const rowsHTML = list
    .map((u) => {
      const uid = esc(u.id);
      const name = esc(u.name);
      const phone = esc(u.phone || "");
      const amount = euro(u.amount);

      const flagISO = PAYMENT_FLAGS.get(u.id);
      const flagTxt = flagISO ? new Date(flagISO).toLocaleString("nl-NL") : "—";

      const attemptCell = flagISO
        ? `${flagTxt} ${
            ADMIN_MODE
              ? `<button class="btn pb-admin-clear" data-id="${uid}">❌</button>`
              : ""
          }`
        : "—";

      const payBtn = `
        <button class="btn pb-pay"
          data-id="${uid}"
          data-amount="${u.amount}">
          Betalen
        </button>`;

      let adminBtns = "";
      if (ADMIN_MODE) {
        adminBtns += `
          <button class="btn pb-admin-paid" data-id="${uid}">
            Betaald
          </button>

          <button class="btn pb-admin-wa"
            data-phone="${phone}">
            Whatsapp
          </button>
        `;
      }

      return `
        <tr>
          <td>${name}</td>
          <td>${u.count}</td>
          <td>${amount}</td>
          <td>${attemptCell}</td>
          <td>${payBtn}${adminBtns}</td>
        </tr>`;
    })
    .join("");

  $("#pb-rows").innerHTML = rowsHTML;

  bindEvents();
}

/* ---------------------------------------------------------
   EVENTS BINDEN
--------------------------------------------------------- */
function bindEvents() {
  document.querySelectorAll(".pb-pay").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.id;

      await flagPaymentAttempt(userId);
      await loadPaymentFlags();
      await renderOpenBalances();

      openPaymentWindow(GLOBAL_PAYLINK);
    });
  });

  document.querySelectorAll(".pb-admin-paid").forEach((btn) => {
    btn.addEventListener("click", () => pbMarkPaid(btn.dataset.id));
  });

  document.querySelectorAll(".pb-admin-wa").forEach((btn) => {
    btn.addEventListener("click", () => {
      openWhatsappToUser(btn.dataset.phone);
    });
  });

  document.querySelectorAll(".pb-admin-clear").forEach((btn) => {
    btn.addEventListener("click", () => pbClearFlag(btn.dataset.id));
  });
}

/* ---------------------------------------------------------
   ADMIN-MODUS
--------------------------------------------------------- */
function toggleAdminMode() {
  const pin = prompt("Voer admin-PIN in:");
  if (pin !== "0000") return toast("❌ Onjuiste PIN");

  ADMIN_MODE = !ADMIN_MODE;
  renderOpenBalances();
}

/* ---------------------------------------------------------
   ADMIN: MARK AS PAID
--------------------------------------------------------- */
window.pbMarkPaid = async (userId) => {
  const balances = await computeOpenBalances("");
  const entry = balances.find((a) => a.id === userId);
  const amount = entry?.amount || 0;

  if (amount <= 0) return toast("Geen openstaand saldo");

  await supabase.from("payments").insert([{ user_id: userId, amount }]);
  await supabase.from("drinks").delete().eq("user_id", userId);
  await supabase.from("payment_flags").delete().eq("user_id", userId);

  toast(`✅ Betaald: ${euro(amount)}`);

  await loadPaymentFlags();
  await renderOpenBalances();
};

/* ---------------------------------------------------------
   BETAALLINK LADEN
--------------------------------------------------------- */
async function loadGlobalPayLink() {
  const { data } = await supabase
    .from("view_payment_link_latest")
    .select("link")
    .maybeSingle();

  GLOBAL_PAYLINK = data?.link || null;
}

/* ---------------------------------------------------------
   FLAG FUNCTIES
--------------------------------------------------------- */
async function flagPaymentAttempt(userId) {
  const ts = new Date().toISOString();

  await supabase.from("payment_flags").upsert(
    {
      user_id: userId,
      attempted_at: ts,
    },
    { onConflict: "user_id" }
  );

  PAYMENT_FLAGS.set(userId, ts);
}

async function loadPaymentFlags() {
  PAYMENT_FLAGS.clear();

  const { data } = await supabase
    .from("payment_flags")
    .select("user_id, attempted_at");

  for (const r of data || []) {
    PAYMENT_FLAGS.set(r.user_id, r.attempted_at);
  }
}

window.pbClearFlag = async (userId) => {
  await supabase.from("payment_flags").delete().eq("user_id", userId);

  toast("❌ Flag verwijderd");
  await loadPaymentFlags();
  await renderOpenBalances();
};
