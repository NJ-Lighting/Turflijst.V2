import { $, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

export async function loadUsersToSelects(selFilter = '#filter-user', selPay = '#pay-user'){
  const { data: users, error } = await supabase.from('users').select('id, name').order('name', { ascending: true });
  if(error){ console.error(error); return; }
  const optsAll  = ['— Alle gebruikers —'].concat((users||[]).map(u => `<option value="${u.id}">${esc(u.name)}</option>`)).join('');
  const optsPick = ['— Kies gebruiker —' ].concat((users||[]).map(u => `<option value="${u.id}">${esc(u.name)}</option>`)).join('');
  if(selFilter) $(selFilter).innerHTML = optsAll;
  if(selPay)    $(selPay).innerHTML    = optsPick;
}

export async function loadKPIs(){
  const { data: d }  = await supabase.from('drinks').select('products(price)').returns(Array);
  const advanced = (d||[]).reduce((sum, row) => sum + (row?.products?.price || 0), 0);

  const { data: sb } = await supabase.from('stock_batches').select('quantity, price_per_piece').gt('quantity', 0);
  const fridge = (sb||[]).reduce((sum, b) => sum + (b.quantity * (b.price_per_piece || 0)), 0);

  // TODO: echte statiegeldcirculatie koppelen
  const depositCirculation = 0;

  $('#kpi-advanced').textContent = euro(advanced);
  $('#kpi-fridge').textContent = euro(fridge);
  $('#kpi-deposit-circulation').textContent = euro(depositCirculation);
}

export async function loadSoldPerProduct(){
  const { data, error } = await supabase.from('drinks').select('products(name)').returns(Array);
  if(error){ console.error(error); return; }
  const counts = {};
  (data||[]).forEach(r => {
    const name = r?.products?.name || 'Onbekend';
    counts[name] = (counts[name] || 0) + 1;
  });
  const rows = Object.entries(counts)
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([name, n]) => `<tr><td>${esc(name)}</td><td>${n}</td></tr>`)
    .join('');
  $('#tbl-sold-per-product').innerHTML = rows;
}

export async function loadPayments(selRows = '#tbl-payments', selFilterUser = '#filter-user'){
  const userId = $(selFilterUser).value;
  let query = supabase.from('payments').select('id, amount, note, created_at, users(name)');
  if(userId) query = query.eq('user_id', userId);
  query = query.order('created_at', { ascending:false }).limit(300);
  const { data, error } = await query;
  if(error){ console.error(error); return; }

  const rows = (data||[]).map(p => {
    const dt = formatDate(p.created_at);
    const user = p?.users?.name || 'Onbekend';
    const note = p?.note || '—';
    return `<tr><td>${dt}</td><td>${esc(user)}</td><td>${euro(p.amount||0)}</td><td>${esc(note)}</td></tr>`;
  }).join('');
  $(selRows).innerHTML = rows;
}

export async function addPayment(selUser='#pay-user', selAmount='#pay-amount', selNote='#p-note', after=()=>{}){
  const userId = $(selUser).value;
  const amountStr = $(selAmount).value.trim();
  const note = $(selNote)?.value.trim() || '';
  if(!userId) return toast('⚠️ Kies eerst een gebruiker');
  const amount = parseFloat(amountStr.replace(',', '.'));
  if(!(amount > 0)) return toast('⚠️ Vul een geldig bedrag in');

  const extRef = `v2pay-${userId}-${Date.now()}`;
  const payload = { user_id: userId, amount, ext_ref: extRef };
  if(note) payload.note = note;

  const { error } = await supabase.from('payments').insert([payload]);
  if(error){ console.error(error); return toast('❌ Fout bij registreren betaling'); }
  toast('✅ Betaling geregistreerd');
  $(selAmount).value = '';
  if($(selNote)) $(selNote).value = '';
  await after();
}

export async function deletePayment(id, after=()=>{}){
  if(!confirm('Weet je zeker dat je deze betaling wilt verwijderen?')) return;
  const { error } = await supabase.from('payments').delete().eq('id', id);
  if(error){ console.error(error); return toast('❌ Verwijderen mislukt'); }
  toast('✅ Betaling verwijderd');
  await after();
}
