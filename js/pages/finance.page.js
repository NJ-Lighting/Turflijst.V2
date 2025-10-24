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
    await addPayment('#pay-user', '#pay-amount', '#p-note', async () => {
      await loadPayments();
      await loadKPIs();
      await loadOpenPerUser();
      await loadAging();
      await loadMonthlyStats('#month-stats');
    });
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

  // Globale delete (voor inline onclick)
  window.deletePayment = async (id) => {
    await deletePayment(id, async () => {
      await loadPayments();
      await loadKPIs();
      await loadOpenPerUser();
      await loadAging();
      await loadMonthlyStats('#month-stats');
      if (typeof loadDepositMetrics === 'function') await loadDepositMetrics();
    });
  };
});
