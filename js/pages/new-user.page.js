// /js/pages/new-user.page.js
import { $, toast, esc } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  $('#nu-submit')?.addEventListener('click', addUser);
  await loadRecentUsers();
});

async function addUser() {
  // v1-stijl: probeer first/last te lezen; anders gebruik #nu-name
  const first  = $('#nu-first')?.value?.trim() || '';
  const last   = $('#nu-last')?.value?.trim()  || '';
  const single = $('#nu-name')?.value?.trim()  || '';
  const fullName = (first || last) ? `${first} ${last}`.trim() : single;
  if (!fullName || fullName.length < 2) return toast('⚠️ Vul een geldige naam in');

  const phone  = $('#nu-phone')?.value?.trim()  || '';
  const avatar = $('#nu-avatar')?.value?.trim() || '';

  const payload = { name: fullName };
  if (phone)  payload.phone  = phone;
  if (avatar) payload.avatar = avatar;

  const { error } = await supabase.from('users').insert([payload]);
  if (error) {
    console.error(error);
    return toast('❌ Toevoegen mislukt');
  }

  toast('✅ Gebruiker toegevoegd');

  // Formulier legen indien aanwezig
  if ($('#nu-first'))  $('#nu-first').value  = '';
  if ($('#nu-last'))   $('#nu-last').value   = '';
  if ($('#nu-name'))   $('#nu-name').value   = '';
  if ($('#nu-phone'))  $('#nu-phone').value  = '';
  if ($('#nu-avatar')) $('#nu-avatar').value = '';

  // (v1-flow) terug naar hoofdpagina
  setTimeout(() => {
    window.location.href = '/index.html';
  }, 400);
}

async function loadRecentUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('name, phone')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error(error);
    return;
  }
  if (!$('#nu-recent')) return;

  $('#nu-recent').innerHTML = (users || [])
    .map((u) => `
      <tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.phone || '-')}</td>
      </tr>
    `)
    .join('');
}
