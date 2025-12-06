/* ---------------------------------------------------------
   Cache Control Script
   - Verwijdert oude Service Workers
   - Forceert altijd nieuwe versies van JS & CSS
   - Voorkomt dat gebruikers oude of lege HTML zien
--------------------------------------------------------- */

// 1) Verwijder ALLE oude Service Workers
//    (voorkomt harde caching / lege pagina's / oude HTML)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}


// 2) Auto-versioning voor ALLE JS-bestanden (behalve met data-no-version-tag)
//    Dit zorgt dat browsers nooit cached scripts gebruiken.
const version = Date.now();

// Versioneer alle JS <script>-tags
document.querySelectorAll('script[src]:not([data-no-version])').forEach((el) => {
  try {
    const url = new URL(el.src);
    url.searchParams.set("v", version);
    el.src = url.toString();
  } catch (e) {
    console.warn("Kon script niet versieneren:", el.src, e);
  }
});

// Versioneer alle CSS <link>-tags
document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
  try {
    const url = new URL(el.href);
    url.searchParams.set("v", version);
    el.href = url.toString();
  } catch (e) {
    console.warn("Kon stylesheet niet versieneren:", el.href, e);
  }
});

// Debug (kan uit)
console.log("Cache-control actief, versie:", version);
