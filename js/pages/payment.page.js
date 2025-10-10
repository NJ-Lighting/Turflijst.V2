import { $, euro, esc, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import { loadUsersToSelects, loadPayments, addPayment, deletePayment } from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsersToSelects('#p-filter-user', '#p-user'); // overload met selectors
  await loadPayments('#p-rows', '#p-filter-user');
  $('#p-add')?.addEventListener('click', () => addPayment('#p-user', '#p-amount', '#p-note', () => loadPayments('#p-rows', '#p-filter-user')));
  $('#p-filter-user')?.addEventListener('change', () => loadPayments('#p-rows', '#p-filter-user'));
});

window.deletePayment = (id) => deletePayment(id, () => loadPayments('#p-rows', '#p-filter-user'));
