// /js/payments/open-payment.js

export function openPaymentWindow(url) {
  if (!url) {
    alert("⚠️ Geen betaallink ingesteld.");
    return;
  }

  const ua = navigator.userAgent;

  const isIOS =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);

  let win = null;

  if (isIOS && isSafari) {
    // iPhone fix → popup MOET vooraf geopend worden
    try {
      win = window.open("", "_blank", "noopener,noreferrer");
    } catch (e) {
      console.warn("Popup vooraf openen mislukt:", e);
    }

    // fallback: als popup geblokkeerd → open in huidige tab
    if (!win) {
      window.location.href = url;
      return;
    }

    // redirect de popup
    win.location.href = url;
    return;
  }

  // Android / Chrome / Desktop → GEWOON 1 tab openen
  window.open(url, "_blank", "noopener,noreferrer");
}
