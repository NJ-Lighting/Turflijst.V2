import { $, $$, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import {
  loadUsersToSelects,
  loadKPIs,
  loadSoldPerProduct,
  loadPayments,
  addPayment,
  deletePayment,
} from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsersToSelects();
  await loadKPIs();
  await loadSoldPerProduct();
  await loadPayments();

  // Add payment met refresh na afloop
  $('#btn-add-payment')?.addEventListener('click', () =>
    addPayment('#pay-user', '#pay-amount', '#p-note', loadPayments)
  );

  // Filter op gebruiker
  $('#filter-user')?.addEventListener('change', () => loadPayments());

  // inline onclick delete in tabel
  window.deletePayment = (id) => deletePayment(id, loadPayments);
});
