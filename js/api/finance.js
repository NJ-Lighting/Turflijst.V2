// /js/api/finance.js
import { $, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

/* ---------- Selects ---------- */
export async function loadUsersToSelects(selFilter = '#filter-user', selPay = '#pay-user'){
  const { data: users, error } = await supabase
    .from('users').select('id, name').order('name', { ascending: true });
  if(error){ console.error(error); return; }

  const optsAll = ['<option value="">— Alle gebruikers —</option>']
    .concat((users||[]).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`))
    .join('');
  const optsPick = ['<option value="">— Kies gebruiker —</option>']
    .concat((users||[]).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`))
    .join('');

  if (selFilter && $(selFilter)) $(selFilter).innerHTML = optsAll;
  if (selPay    && $(selPay))    $(selPay).innerHTML    = optsPick;
}

/* ---------- KPI's (V1 parity) ---------- */
export async function loadKPIs(){
  // Onbetaald (consumptie)
  const { data: d } = await supabase
    .from('drinks')
    .select('products(price)')
    .returns(Array);
  const unpaid = (d||[]).reduce((sum, row) => sum + (row?.products?.price || 0), 0);

  // Voorraadwaarde (actueel)
  const { data: sb } = await supabase
    .from('stock_batches')
    .select('quantity, price_per_piece')
    .gt('quantity', 0);
  const fridge = (sb||[]).reduce((sum, b) => sum + ((Number(b.quantity)||0) * (Number(b.price_per_piece)||0)), 0);

  // Ontvangen betalingen
  const { data: pays } = await supabase.from('payments').select('amount');
  const received = (pays||[]).reduce((s,p)=> s + Number(p.amount||0), 0);

  // Deposits (statiegeld)
  const { data: deps } = await supabase.from('deposits').select('amount');
  const depositIn = (deps||[]).reduce((s,p)=> s + Number(p.amount||0), 0);

  // Buffer OUT gelogd op batches (kolom 'buffer_used' indien aanwezig)
  let bufferOut = 0;
  try {
    const { data: sb2 } = await supabase
      .from('stock_batches')
      .select('buffer_used')
      .gt('buffer_used', 0);
    bufferOut = (sb2||[]).reduce((s,b)=> s + Number(b.buffer_used||0), 0);
  } catch{}

  const bufferAvailable = Math.max(0, depositIn - bufferOut);

  const prepaid = fridge + unpaid;                 // Totale voorgeschoten
  const profit  = (received + depositIn) - prepaid;

  // Render (alle zijn optioneel; render alleen als element bestaat)
  const set = (sel, val) => { if($(sel)) $(sel).textContent = euro(val); };
  set('#kpi-fridge', fridge);
  set('#kpi-prepaid', prepaid);
  set('#kpi-received', received);
  set('#kpi-deposit-earned', depositIn);
  set('#kpi-profit', profit);
  // Buffer-blok (nieuw in V2)
  set('#kpi-buffer-in', depositIn);
  set('#kpi-buffer-out', bufferOut);
  set('#kpi-buffer-available', bufferAvailable);
}

/* ---------- Verkochte blikjes per product ---------- */
export async function loadSoldPerProduct(){
  const { data, error } = await supabase
    .from('drinks')
    .select('products(name)')
    .returns(Array);
  if(error){ console.error(error); return; }

  const counts = {};
  (data||[]).forEach(r => {
    const name = r?.products?.name || 'Onbekend';
    counts[name] = (counts[name] || 0) + 1;
  });

  const rows = Object.entries(counts)
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([name, n]) => `<tr><td>${esc(name)}</td><td style="text-align:right">${n}</td></tr>`)
    .join('');

  if ($('#tbl-sold-per-product')) $('#tbl-sold-per-product').innerHTML = rows;
}

/* ---------- Betalingen ---------- */
export async function loadPayments(selRows = '#tbl-payments', selFilterUser = '#filter-user'){
  const userId = $(selFilterUser)?.value;
  let query = supabase
    .from('payments')
    .select('id, amount, note, created_at, users(name)');

  if(userId) query = query.eq('user_id', userId);
  query = query.order('created_at', { ascending:false }).limit(300);

  const { data, error } = await query;
  if(error){ console.error(error); return; }

  const rows = (data||[]).map(p => {
    const dt = formatDate(p.created_at);
    const user = p?.users?.name || 'Onbekend';
    const note = p?.note || '—';
    return `
      <tr>
        <td>${esc(dt)}</td>
        <td>${esc(user)}</td>
        <td style="text-align:right">${euro(p.amount||0)}</td>
        <td>${esc(note)}</td>
        <td><button class="link" onclick="deletePayment(${p.id})">Verwijderen</button></td>
      </tr>
    `;
  }).join('');

  if ($(selRows)) $(selRows).innerHTML = rows;
}

export async function addPayment(selUser='#pay-user', selAmount='#pay-amount', selNote='#p-note', after=()=>{}){
  const userId    = $(selUser)?.value;
  const amountStr = $(selAmount)?.value?.trim() || '';
  const note      = $(selNote)?.value?.trim() || '';

  if(!userId) return toast('⚠️ Kies eerst een gebruiker');
  const amount = parseFloat(amountStr.replace(',', '.'));
  if(!(amount > 0)) return toast('⚠️ Vul een geldig bedrag in');

  const extRef = `v2pay-${userId}-${Date.now()}`;
  const payload = { user_id: userId, amount, ext_ref: extRef };
  if(note) payload.note = note;

  const { error } = await supabase.from('payments').insert([payload]);
  if(error){
    console.error(error);
    return toast('❌ Fout bij registreren betaling');
  }
  toast('✅ Betaling geregistreerd');

  if($(selAmount)) $(selAmount).value = '';
  if($(selNote))   $(selNote).value   = '';
  await after();
}

export async function deletePayment(id, after=()=>{}){
  if(!confirm('Weet je zeker dat je deze betaling wilt verwijderen?')) return;
  const { error } = await supabase.from('payments').delete().eq('id', id);
  if(error){
    console.error(error);
    return toast('❌ Verwijderen mislukt');
  }
  toast('✅ Betaling verwijderd');
  await after();
}

/* ---------- Deposits / Buffer ---------- */
export async function addDeposit(selAmount='#deposit-amount', selNote='#deposit-note', after=()=>{}){
  const amountStr = $(selAmount)?.value?.trim() || '';
  const note      = $(selNote)?.value?.trim() || '';
  const amount = parseFloat(amountStr.replace(',', '.'));
  if(!(amount > 0)) return toast('⚠️ Vul een geldig statiegeld-bedrag in');

  const payload = { amount };
  if (note) payload.note = note;

  const { error } = await supabase.from('deposits').insert([payload]);
  if (error){
    console.error(error);
    return toast('❌ Fout bij opslaan statiegeld');
  }
  toast('✅ Statiegeld geregistreerd');

  if($(selAmount)) $(selAmount).value = '';
  if($(selNote))   $(selNote).value   = '';

  await after();
}

export async function loadDepositMetrics(){
  // hergebruik loadKPIs zodat de UI consistent blijft
  await loadKPIs();
}

/* ---------- Maand-statistiek (optioneel) ---------- */
export async function loadMonthlyStats(selContainer='#month-stats'){
  if (!$(selContainer)) return; // alleen draaien als er UI voor is

  // drinks per maand
  const { data: drinks } = await supabase
    .from('drinks')
    .select('created_at, products(price)');
  // payments per maand
  const { data: pays } = await supabase
    .from('payments')
    .select('created_at, amount');
  // deposits per maand
  const { data: deps } = await supabase
    .from('deposits')
    .select('created_at, amount');

  const monthKey = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  };

  const sums = {};

  (drinks||[]).forEach(d => {
    const k = monthKey(d.created_at);
    sums[k] = sums[k] || { sales:0, payments:0, deposits:0 };
    sums[k].sales += (d.products?.price || 0);
  });
  (pays||[]).forEach(p => {
    const k = monthKey(p.created_at);
    sums[k] = sums[k] || { sales:0, payments:0, deposits:0 };
    sums[k].payments += Number(p.amount||0);
  });
  (deps||[]).forEach(dp => {
    const k = monthKey(dp.created_at);
    sums[k] = sums[k] || { sales:0, payments:0, deposits:0 };
    sums[k].deposits += Number(dp.amount||0);
  });

  const rows = Object.entries(sums)
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([m, v]) => `
      <tr>
        <td>${esc(m)}</td>
        <td style="text-align:right">${euro(v.sales)}</td>
        <td style="text-align:right">${euro(v.payments)}</td>
        <td style="text-align:right">${euro(v.deposits)}</td>
      </tr>
    `).join('');

  $(selContainer).innerHTML = rows;
}
