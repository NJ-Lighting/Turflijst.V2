// /js/pin.js
// Simpele client-side PIN gate
// Bewust GEEN echte security – alleen UI-blokkade

const ADMIN_PIN = '0000'; // <-- HIER je PIN aanpassen
const PIN_KEY = 'turflijst_admin_pin_ok';

export function requirePin() {
  // PIN al ingevoerd in deze tab?
  if (sessionStorage.getItem(PIN_KEY) === 'yes') {
    return true;
  }

  const input = prompt('Admin PIN:');

  if (input === ADMIN_PIN) {
    sessionStorage.setItem(PIN_KEY, 'yes');
    return true;
  }

  // Geen toegang → pagina stoppen
  document.body.innerHTML = `
    <div style="padding:2rem; font-family:sans-serif;">
      <h2>❌ Geen toegang</h2>
      <p>Onjuiste PIN</p>
    </div>
  `;
  return false;
}
