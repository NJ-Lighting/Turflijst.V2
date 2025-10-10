// /js/pages/new-user.page.js
import { $, toast, esc } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  $('#nu-submit')?.addEventListener('click', addUser);
  await loadRecentUsers();
});

async function addUser() {
  const name = $('#nu-name').value.trim();
  const phone = $('#nu-phone').value.trim();
  const avatar = $('#nu-avatar').value.trim();
  if (!name) return toast('⚠️ Vul een naam in');
  const payload = { name };
  if (phone) payload.phone = phone;
  if (avatar) payload.avatar = avatar;
  const { error } = await supabase.from('users').insert([payload]);
  if (error) return console.error(error);
  toast('✅ Gebruiker toegevoegd');
  $('#nu-name').value = '';
  $('#nu-phone').value = '';
  $('#nu-avatar').value = '';
  await loadRecentUsers();
}

async function loadRecentUsers() {
  const { data: users, error } = await supabase
    .from('users')
    .select('name, phone')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return console.error(error);
  $('#nu-recent').innerHTML = (users || [])
    .map(
      (u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.phone || '-')}</td></tr>`
    )
    .join('');
}
