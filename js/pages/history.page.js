// /js/pages/history.page.js
import { $, euro, esc } from '../core.js';
import { supabase } from '../supabase.client.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadUsers();
  setDefaultDates();
  $('#h-apply')?.addEventListener('click', loadHistory);
  await loadHistory();
});

async function loadUsers(){
  const { data: users, error } = await supabase
    .from('users').select('id, name')
    .order('name', { ascending: true });
  if(error){ console.error(error); return; }

  const opts = ['<option value="">— Alle gebruikers —</option>']
    .concat((users||[]).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`))
    .join('');
  if ($('#h-user')) $('#h-user').innerHTML = opts;
}

function setDefaultDates(){
  const to = new Date();
  const from = new Date(Date.now() - 29 * 864e5);
  if ($('#h-from')) $('#h-from').value = toDateInput(from);
  if ($('#h-to'))   $('#h-to').value   = toDateInput(to);
}

export async function loadHistory(){
  const userId = $('#h-user')?.value || '';
  const from = $('#h-from')?.value ? new Date($('#h-from').value) : null;
  const to   = $('#h-to')?.value   ? new Date($('#h-to').value)   : null;

  let query = supabase
    .from('drinks')
    .select('created_at, users(name), products(name, price)')
    .order('created_at', { ascending: false })
    .limit(500);

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if(error){ console.error(error); return; }

  const rows = [];
  let sum = 0;

  (data||[])
    .filter(r => {
      const t = new Date(r.created_at);
      const inFrom = from ? t >= truncDay(from) : true;
      const inTo   = to   ? t <= endOfDay(to)   : true;
      return inFrom && inTo;
    })
    .forEach(r => {
      const dt = new Date(r.created_at).toLocaleString?.('nl-NL') || new Date(r.created_at).toISOString();
      const user  = r?.users?.name || 'Onbekend';
      const prod  = r?.products?.name || '—';
      const price = r?.products?.price || 0;
      sum += price;
      rows.push(`
        <tr>
          <td>${esc(dt)}</td>
          <td>${esc(user)}</td>
          <td>${esc(prod)}</td>
          <td style="text-align:right">${euro(price)}</td>
        </tr>
      `);
    });

  if ($('#h-rows')) $('#h-rows').innerHTML = rows.join('');
  if ($('#h-sum'))  $('#h-sum').textContent = euro(sum);
}

// local utils
function truncDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function toDateInput(d){ return d.toISOString().slice(0,10); }
