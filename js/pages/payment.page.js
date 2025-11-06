// /js/pages/payment.page.js
// type: module
import { $, toast } from '../core.js';
import {
  loadUsersToSelects,
  loadPayments,
  addPayment,
  deletePayment as apiDeletePayment
} from '../api/finance.js';

// Helper: pak de eerste selector die op de pagina voorkomt
function pickSel(...sels){
  for (const s of sels){
    const el = document.querySelector(s);
    if (el) return s;
  }
  return sels[0];
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Ondersteun zowel de nieuwe #p-* IDs als de defaults uit finance.js
    const selFilter = pickSel('#p-filter-user', '#filter-user');
    const selPayUsr = pickSel('#p-user', '#pay-user');
    const selRows   = pickSel('#p-rows', '#tbl-payments');
    const selAmt    = pickSel('#p-amount', '#pay-amount');
    const selNote   = pickSel('#p-note', '#pay-note');
    const btnAdd    = document.querySelector('#p-add') || document.querySelector('#pay-add');

    // Init
    await loadUsersToSelects(selFilter, selPayUsr);
    await loadPayments(selRows, selFilter);

    // Voeg betaling toe
    btnAdd?.addEventListener('click', () =>
      addPayment(selPayUsr, selAmt, selNote, () => loadPayments(selRows, selFilter))
    );

    // Filter wisselt → lijst herladen
    document.querySelector(selFilter)?.addEventListener('change', () =>
      loadPayments(selRows, selFilter)
    );

    // Verwijderknoppen uit de lijst kunnen hierop leunen
    if (typeof window !== 'undefined') {
      window.uiDeletePayment = async (id) => {
        await apiDeletePayment(id, () => loadPayments(selRows, selFilter));
      };
    }
  } catch (e) {
    console.error('[payment.page] init error:', e);
    toast('❌ Kon Payment-pagina niet initialiseren');
  }
});
