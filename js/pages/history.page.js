import { $ } from '../core.js';
import {
  loadUsersToSelects,
  loadKPIs,
  loadSoldPerProduct,
  loadPayments,
  addPayment,
  addDeposit,
  loadMonthlyStats,
  deletePayment,
  loadOpenPerUser,
  loadAging
} from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsersToSelects();

  const refreshAll = async () => {
    await Promise.all([
      loadKPIs(),
      loadSoldPerProduct(),
      loadPayments(),
      loadOpenPerUser(),
      loadAging(),
      loadMonthlyStats('#month-stats'),
    ]);
  };

  await refreshAll();
  $('#btn-refresh')?.addEventListener('click', refreshAll);

  // Betaling toevoegen
  $('#btn-add-payment')?.addEventListener('click', () =>
    addPayment('#pay-user', '#pay-amount', '#p-note', async () => {
      await loadPayments();
      await loadKPIs();
      await loadOpenPerUser();
      await loadAging();
      await loadMonthlyStats('#month-stats');
    })
  );

  // Statiegeld opslaan (buffer in)
  $('#btn-add-deposit')?.addEventListener('click', () =>
    addDeposit('#deposit-amount', '#deposit-note', async () => {
      await loadKPIs();
      await loadOpenPerUser();
      await loadAging();
      await loadMonthlyStats('#month-stats');
    })
  );

  // Filter wissel
  $('#filter-user')?.addEventListener('change', () => loadPayments());

  // Verwijderen (werkt met inline onclick uit api/finance.js)
  window.deletePayment = async (id) => {
    await deletePayment(id, async () => {
      await loadPayments();
      await loadKPIs();
      await loadOpenPerUser();
      await loadAging();
      await loadMonthlyStats('#month-stats');
    });
  };
});
