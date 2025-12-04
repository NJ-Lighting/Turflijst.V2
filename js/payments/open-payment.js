// /js/payments/open-payment.js

/**
 * Opent een payment link op een manier die werkt op:
 * - iPhone Safari
 * - Android Chrome
 * - Desktop browsers
 *
 * @param {string} url - De betaallink
 */
export function openPaymentWindow(url) {
  if (!url) {
    alert("⚠️ Geen betaallink ingesteld.");
    return;
  }

  let win = null;

  // iPhone moet direct in de click een window openen
  try {
    win = window.open("", "_blank", "noopener,noreferrer");
  } catch (e) {
    console.warn("Popup kon niet vooraf worden geopend:", e);
  }

  // Fallback voor browsers die geen leeg tabblad toestaan
  if (!win) {
    window.location.href = url;
    return;
  }

  // Zet de URL zodra we mogen redirecten
  win.location.href = url;
}
