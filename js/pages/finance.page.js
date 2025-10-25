import { $ } from '../core.js';
import {
  loadUsersToSelects,
  loadKPIs,
  loadSoldPerProduct,
  loadPayments,
  addPayment,
  deletePayment,
  addDeposit,
  loadDepositMetrics,
  loadMonthlyStats,
  loadOpenPerUser,
  loadAging
} from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsersToSelects();
  await Promise.all([
    loadKPIs(),
    loadSoldPerProduct(),
    loadPayments(),
    loadOpenPerUser(),
    loadAging(),
    loadMonthlyStats('#month-stats'),
  ]);

  // Betaling toevoegen
  $('#btn-add-payment')?.addEventListener('click', async () => {
    await addPayment('#pay-user', '#pay-amount', null, async () => {
      await loadPayments();
      await loadKPIs();
      await loadOpenPerUser();
      await loadAging();
      await loadMonthlyStats('#month-stats');
    });
  });

  // Vernieuwen
  $('#btn-refresh')?.addEventListener('click', async () => {
    await loadUsersToSelects();
    await loadKPIs();
    await loadSoldPerProduct();
    await loadPayments();
    await loadOpenPerUser();
    await loadAging();
    await loadMonthlyStats('#month-stats');
  });

  // Statiegeld opslaan (buffer in)
  $('#btn-add-deposit')?.addEventListener('click', async () => {
    await addDeposit('#deposit-amount', '#deposit-note', async () => {
      await loadKPIs();
      await loadMonthlyStats('#month-stats');
      if (typeof loadDepositMetrics === 'function') await loadDepositMetrics();
    });
  });

  // Filter wissel
  $('#filter-user')?.addEventListener('change', async () => {
    await loadPayments();
  });

  // Delete via event delegation
  $('#tbl-payments')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-del-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-del-id');
    await deletePayment(id, async () => {
      await loadPayments();
      await loadKPIs();
      await loadOpenPerUser();
      await loadAging();
      await loadMonthlyStats('#month-stats');
      if (typeof loadDepositMetrics === 'function') await loadDepositMetrics();
    });
  });
});
