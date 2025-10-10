// /js/pages/finance.page.js
import { $, $$, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';
import {
  loadUsersToSelects,
  loadKPIs,
  loadSoldPerProduct,
  loadPayments,
  addPayment,
  deletePayment,
  addDeposit,            // nieuw
  loadDepositMetrics,    // nieuw
  loadMonthlyStats,      // nieuw (bestaat alleen als je er UI voor hebt)
} from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsersToSelects();
  await loadKPIs();
  await loadSoldPerProduct();
  await loadPayments();
  if (typeof loadDepositMetrics === 'function') await loadDepositMetrics();
  if (typeof loadMonthlyStats   === 'function') await loadMonthlyStats();

  // Betaling registreren
  $('#btn-add-payment')?.addEventListener('click', async () => {
    await addPayment('#pay-user', '#pay-amount', '#p-note', async () => {
      await loadPayments();
      await loadKPIs();
    });
  });

  // Statiegeld registreren
  $('#btn-add-deposit')?.addEventListener('click', async () => {
    if (typeof addDeposit !== 'function') return toast('Functie addDeposit ontbreekt');
    await addDeposit('#deposit-amount', '#deposit-note', async () => {
      await loadKPIs();
      if (typeof loadDepositMetrics === 'function') await loadDepositMetrics();
    });
  });

  // Filter op gebruiker
  $('#filter-user')?.addEventListener('change', async () => {
    await loadPayments();
  });

  // (optioneel) Maandfilter voor statistiek
  $('#month-range')?.addEventListener('change', async () => {
    if (typeof loadMonthlyStats === 'function') await loadMonthlyStats();
  });

  // inline onclick delete in tabel
  window.deletePayment = async (id) => {
    await deletePayment(id, async () => {
      await loadPayments();
      await loadKPIs();
      if (typeof loadDepositMetrics === 'function') await loadDepositMetrics();
    });
  };
});
