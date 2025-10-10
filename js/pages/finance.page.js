import { $, $$, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import {
  loadUsersToSelects,
  loadKPIs,
  loadSoldPerProduct,
  loadPayments,
  addPayment
} from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsersToSelects();
  await loadKPIs();
  await loadSoldPerProduct();
  await loadPayments();
  $('#btn-add-payment')?.addEventListener('click', addPayment);
  $('#filter-user')?.addEventListener('change', () => loadPayments());
});
