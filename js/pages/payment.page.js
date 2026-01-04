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

  const [{ data: rows }, { data: flags }] = await Promise.all([
    supabase
      .from("drinks")
      .select("user_id, price_at_purchase, created_at"),
    supabase
      .from("payment_flags")
      .select("user_id, amount, attempted_at")
  ]);

  // ✅ FLAG MAP (DIT MISSE JE)
  const flagMap = new Map();
  (flags || []).forEach(f => {
    flagMap.set(f.user_id, {
      amount: Number(f.amount),
      attempted_at: new Date(f.attempted_at)
    });
  });

  const sum = new Map();
  const cnt = new Map();

  // ✅ NIEUW: sinds betaalpoging (alleen NA attempted_at)
  const sinceSum = new Map();
  const sinceCnt = new Map();

  (rows || []).forEach((r) => {
    const price = Number(r.price_at_purchase || 0);
    const drinkTime = new Date(r.created_at);
    const flag = flagMap.get(r.user_id);

    // count: altijd totaal tellen (baseline liet dit impliciet zo; we houden het logisch stabiel)
    cnt.set(r.user_id, (cnt.get(r.user_id) || 0) + 1);

    if (flag) {
      // ✅ alleen drankjes NA betaalpoging tellen voor "Nieuw sinds betaalpoging"
      if (drinkTime > flag.attempted_at) {
        sinceSum.set(r.user_id, (sinceSum.get(r.user_id) || 0) + price);
        sinceCnt.set(r.user_id, (sinceCnt.get(r.user_id) || 0) + 1);
      }
      // amount blijft vast via flag.amount (dus sum niet nodig voor flagged users)
    } else {
      // ✅ geen betaalpoging → alles telt voor optelsom
      sum.set(r.user_id, (sum.get(r.user_id) || 0) + price);
    }
  });

  const q = searchTerm.trim().toLowerCase();

  return (users || [])
    .map((u) => {
      const flag = flagMap.get(u.id);

      return {
        id: u.id,
        name: u.name,
        phone: u.phone,
        amount: flag
          ? flag.amount              // 🔒 VAST BEDRAG
          : (sum.get(u.id) || 0),    // optelsom alleen zonder flag
        count: cnt.get(u.id) || 0,

        // ✅ NIEUW: voor 2e regel
        sinceAmount: sinceSum.get(u.id) || 0,
        sinceCount: sinceCnt.get(u.id) || 0
      };
    })
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

      // ✅ NIEUW: 2e regel (alleen als er een betaalpoging is én er zijn nieuwe drankjes)
      const subRow = (flagISO && (u.sinceAmount > 0 || u.sinceCount > 0))
  ? `
    <tr class="sub-row">
      <td colspan="5" style="font-size:0.9em; opacity:0.75; padding-left:24px">
        ↳ Nieuw sinds betaalpoging:
        ${
          u.sinceAmount > 0
            ? `<strong>${euro(u.sinceAmount)}</strong>`
            : `<strong>€0,00</strong>`
        }
        (${esc(String(u.sinceCount))})
      </td>
    </tr>
  `
  : "";


      return `
        <tr>
          <td>${name}</td>
          <td>${u.count}</td>
          <td>${amount}</td>
          <td>${attemptCell}</td>
          <td>${payBtn}${adminBtns}</td>
        </tr>
        ${subRow}
      `;
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

      const amount = Number(btn.dataset.amount);
      await flagPaymentAttempt(userId, amount);
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

  // 1️⃣ haal attempted_at op
  const { data: flag } = await supabase
    .from("payment_flags")
    .select("attempted_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!flag) {
    toast("⚠️ Geen betaalpoging gevonden");
    return;
  }

  // 2️⃣ payment registreren (ÉÉN KEER)
  await supabase.from("payments").insert([
    { user_id: userId, amount }
  ]);

  // 3️⃣ ALLEEN drankjes vóór betaalpoging verwijderen
  await supabase
    .from("drinks")
    .delete()
    .eq("user_id", userId)
    .lte("created_at", flag.attempted_at);

  // 4️⃣ betaalpoging opruimen
  await supabase
    .from("payment_flags")
    .delete()
    .eq("user_id", userId);

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
async function flagPaymentAttempt(userId, amount) {
  const ts = new Date().toISOString();

  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    toast("⚠️ Ongeldig bedrag");
    return;
  }

  const { error } = await supabase.from("payment_flags").upsert(
    {
      user_id: userId,
      attempted_at: ts,
      amount: n, // ✅ VERPLICHT
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error(error);
    toast("⚠️ Kan betaalpoging niet opslaan");
    return;
  }

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
