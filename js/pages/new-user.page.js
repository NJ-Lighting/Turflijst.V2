import { $, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', () => {
  $('#nu-submit')?.addEventListener('click', addUser);
});

async function addUser() {
  const fullName = $('#nu-name')?.value?.trim() || '';
  if (!fullName || fullName.length < 2) {
    return toast('⚠️ Vul een geldige naam in');
  }

  const phone = $('#nu-phone')?.value?.trim() || '';

  const payload = { name: fullName };
  if (phone) payload.phone = phone;

  const { error } = await supabase.from('users').insert([payload]);
  if (error) {
    console.error(error);
    return toast('❌ Toevoegen mislukt');
  }

  toast('✅ Gebruiker toegevoegd');

  // velden leegmaken
  $('#nu-name').value = '';
  $('#nu-phone').value = '';

  // terug naar hoofdpagina
  setTimeout(() => (window.location.href = '/index.html'), 400);
}
