// /js/pages/payment.page.js
// type: module
import { $, toast, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';
import {
  loadUsersToSelects,
  loadOpenBalances,
  loadPayments,
  sendPaymentRequest,
  confirmPayment,
  cancelPayment,
  addDirectPayment,
  deletePayment
} from '../api/finance.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadUsersToSelects('#p-filter-user', '#p-user');
    await refreshAll();
  } catch (e) {
    console.error('[payment.page] init error', e);
    toast('❌ Kon betaalgegevens niet laden');
  }

  // filters/acties
  $('#p-filter-user')?.addEventListener('change', refreshAll);
  $('#p-add')?.addEventListener('click', onAddDirectPayment);
  $('#p-send-request')?.addEventListener('click', onSendRequest);
});

async function refreshAll() {
  await loadOpenBalances('#pb-rows', '#pb-search');
  await loadPayments({
    listAllSel: '#p-rows',
    listSentSel: '#p-sent-rows',
    listConfirmedSel: '#p-confirmed-rows',
    filterUserSel: '#p-filter-user'
  });
}

async function onSendRequest() {
  const userId = $('#p-user')?.value || '';
  const amountStr = ($('#p-amount')?.value || '').replace(',', '.');
  const note = $('#p-note')?.value?.trim() || '';
  const method = $('#p-method')?.value || 'Tikkie';
  const amount = Number(amountStr);
  if (!userId) return toast('⚠️ Kies een gebruiker');
  if (!Number.isFinite(amount) || amount <= 0) return toast('⚠️ Ongeldig bedrag');
  await sendPaymentRequest(userId, amount, { note, method });
  toast('✉️ Betaalverzoek verstuurd');
  if ($('#p-amount')) $('#p-amount').value = '';
  if ($('#p-note')) $('#p-note').value = '';
  await refreshAll();
}

async function onAddDirectPayment() {
  const userId = $('#p-user')?.value || '';
  const amountStr = ($('#p-amount')?.value || '').replace(',', '.');
  const note = $('#p-note')?.value?.trim() || '';
  const method = $('#p-method')?.value || 'contant';
  const amount = Number(amountStr);
  if (!userId) return toast('⚠️ Kies een gebruiker');
  if (!Number.isFinite(amount) || amount <= 0) return toast('⚠️ Ongeldig bedrag');
  await addDirectPayment(userId, amount, { note, method });
  toast('✅ Betaling toegevoegd');
  if ($('#p-amount')) $('#p-amount').value = '';
  if ($('#p-note')) $('#p-note').value = '';
  await refreshAll();
}

// Expose knoppen die in de tabel gebruikt worden
if (typeof window !== 'undefined') {
  Object.assign(window, {
    // vanuit “lopende verzoeken”
    uiConfirmPayment: async (paymentId) => {
      await confirmPayment(paymentId);
      toast('✅ Betaling bevestigd');
      await refreshAll();
    },
    uiCancelPayment: async (paymentId) => {
      await cancelPayment(paymentId);
      toast('❌ Verzoek geannuleerd');
      await refreshAll();
    },
    uiDeletePayment: async (paymentId) => {
      await deletePayment(paymentId);
      toast('🗑️ Betaling verwijderd');
      await refreshAll();
    }
  });
}
