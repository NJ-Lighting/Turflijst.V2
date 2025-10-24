import { $ } from '../core.js';
import {
  loadUsersToSelects,
  loadKPIs,
  loadSoldPerProduct,
  loadPayments,
  addPayment,
  addDeposit,
  loadMonthlyStats,
  deletePayment
} from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsersToSelects();

  await Promise.all([
    loadKPIs(),
    loadSoldPerProduct(),
    loadPayments(),
    loadMonthlyStats('#month-stats'),
  ]);

  // Betaling toevoegen
  $('#btn-add-payment')?.addEventListener('click', () =>
    addPayment('#pay-user', '#pay-amount', '#p-note', async () => {
      await loadPayments();
      await loadKPIs();
      await loadMonthlyStats('#month-stats');
    })
  );

  // Statiegeld opslaan (buffer in)
  $('#btn-add-deposit')?.addEventListener('click', () =>
    addDeposit('#deposit-amount', '#deposit-note', async () => {
      await loadKPIs();
      await loadMonthlyStats('#month-stats');
    })
  );

  // Filter wissel
  $('#filter-user')?.addEventListener('change', () => loadPayments());

  // Verwijderen via event delegation
  $('#tbl-payments')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-del-id');
    deletePayment(id, async () => {
      await loadPayments();
      await loadKPIs();
      await loadMonthlyStats('#month-stats');
    });
  });
});
