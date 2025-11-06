import { $, euro, esc, formatDate, toast } from '../core.js';
import { supabase } from '../supabase.client.js';

/* ---------- Selects ---------- */
export async function loadUsersToSelects(selFilter = '#filter-user', selPay = '#pay-user'){
  const { data: users, error } = await supabase
    .from('users').select('id, name').order('name', { ascending: true });
  if(error){ console.error(error); return; }

  const toOpts = (arr, firstLabel) =>
    [`<option value="">${esc(firstLabel)}</option>`,
     ...(arr||[]).map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`)]
    .join('');

  if (selFilter && $(selFilter)) $(selFilter).innerHTML = toOpts(users||[], '— Alle gebruikers —');
  if (selPay && $(selPay)) $(selPay).innerHTML = toOpts(users||[], '— Kies gebruiker —');
}

/* ---------- KPI's ---------- */
export async function loadKPIs(){
  // Openstaand = som onbetaalde drinks (historische kostprijs)
  const { data: unpaidRows } = await supabase
    .from('drinks')
    .select('price_at_purchase, paid')
    .or('paid.eq.false,paid.is.null');
  const unpaid = (unpaidRows||[])
    .reduce((s,r)=> s + Number(r.price_at_purchase||0), 0);

  // Voorraadwaarde (actueel)
  const { data: sb } = await supabase
    .from('stock_batches').select('quantity, price_per_piece').gt('quantity', 0);
  const fridge = (sb||[]).reduce((sum, b) =>
    sum + ((Number(b.quantity)||0) * (Number(b.price_per_piece)||0)), 0);

  // Ontvangen betalingen
  const { data: pays } = await supabase.from('payments').select('amount');
  const received = (pays||[]).reduce((s,p)=> s + Number(p.amount||0), 0);

  // Deposits (statiegeld)
  const { data: deps } = await supabase.from('deposits').select('amount');
  const depositIn = (deps||[]).reduce((s,p)=> s + Number(p.amount||0), 0);

  // Buffer OUT (optioneel)
  let bufferOut = 0;
  try {
    const { data: sb2 } = await supabase
      .from('stock_batches').select('buffer_used').gt('buffer_used', 0);
    bufferOut = (sb2||[]).reduce((s,b)=> s + Number(b.buffer_used||0), 0);
  } catch{}

  const bufferAvailable = Math.max(0, depositIn - bufferOut);
  const prepaid = fridge + unpaid; // voorraad + openstaand

  // Omzet, COGS, Marge (cumulatief)
  const { data: salesRows } = await supabase
    .from('drinks')
    .select('sell_price_at_purchase, price_at_purchase');
  const revenue = (salesRows||[]).reduce((s,r)=> s + Number(r.sell_price_at_purchase||0), 0);
  const cogs = (salesRows||[]).reduce((s,r)=> s + Number(r.price_at_purchase||0), 0);
  const margin = revenue - cogs;

  // Profit (cash-achtig)
  const profit = (received + depositIn) - prepaid;

  const set = (sel, val) => { if($(sel)) $(sel).textContent = euro(val); };

  set('#kpi-fridge', fridge);
  set('#kpi-prepaid', prepaid);
  set('#kpi-received', received);
  set('#kpi-deposit-earned', depositIn);
  set('#kpi-profit', profit);

  // extra KPI’s
  set('#kpi-open', unpaid);
  set('#kpi-revenue', revenue);
  set('#kpi-cogs', cogs);
  set('#kpi-margin', margin);

  // Buffer-blok
  set('#kpi-buffer-in', depositIn);
  set('#kpi-buffer-out', bufferOut);
  set('#kpi-buffer-available', bufferAvailable);
}

/* ---------- Verkochte stuks per product ---------- */
export async function loadSoldPerProduct(){
  const { data, error } = await supabase
    .from('drinks').select('products(name)').returns(Array);
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

  if ($('#tbl-sold-per-product')) $('#tbl-sold-per-product').innerHTML = rows || 'Geen data';
}

/* ---------- Betalingen ---------- */
export async function loadPayments(selRows = '#tbl-payments', selFilterUser = '#filter-user'){
  try {
    if ($(selRows)) $(selRows).innerHTML = `Laden…`;
    const userId = $(selFilterUser)?.value || '';

    // altijd user_id selecteren zodat namen getoond kunnen worden
    let q = supabase.from('payments').select('id, user_id, amount, note, created_at');
    if (userId) q = q.eq('user_id', userId);
    q = q.order('created_at', { ascending: false }).limit(300);

    const { data: pays, error: pErr } = await q;
    if (pErr) {
      console.error('payments query:', pErr);
      if ($(selRows)) $(selRows).innerHTML = `Kon betalingen niet laden`;
      return;
    }

    // Namen in één keer ophalen
    const ids = Array.from(new Set((pays || []).map(p => p.user_id).filter(Boolean)));
    const nameById = new Map();
    if (ids.length) {
      const { data: users, error: uErr } = await supabase
        .from('users').select('id, name').in('id', ids);
      if (uErr) console.error('users for payments:', uErr);
      (users || []).forEach(u => nameById.set(u.id, u.name));
    }

    const rowsHtml = (pays || []).map(p => {
      const dt = formatDate(p.created_at);
      const name = nameById.get(p.user_id) || '—';
      return `
        <tr>
          <td>${esc(dt)}</td>
          <td>${esc(name)}</td>
          <td>${euro(p.amount || 0)}</td>
          <td>${esc(p.note || '')}</td>
          <td><button class="btn btn-small" onclick="deletePayment('${esc(p.id)}')">Verwijderen</button></td>
        </tr>`;
    }).join('');

    $(selRows).innerHTML = rowsHtml || `Geen betalingen gevonden`;
  } catch (e) {
    console.error('loadPayments failed:', e);
    if ($(selRows)) $(selRows).innerHTML = `Kon betalingen niet laden`;
  }
}

export async function addPayment(selUser='#pay-user', selAmount='#pay-amount', selNote='#p-note', after=()=>{}){
  const userId = $(selUser)?.value;
  const amountStr = $(selAmount)?.value?.trim() || '';
  if(!userId) return toast('⚠️ Kies eerst een gebruiker');

  const amount = parseFloat(amountStr.replace(',', '.'));
  if(!(amount > 0)) return toast('⚠️ Vul een geldig bedrag in');

  const extRef = `v2pay-${userId}-${Date.now()}`;
  const note = $(selNote)?.value?.trim() || '';

  const payload = { user_id: userId, amount, ext_ref: extRef };
  if (note) payload.note = note;

  const { error } = await supabase.from('payments').insert([payload]);
  if(error){
    console.error(error);
    return toast('❌ Fout bij registreren betaling');
  }
  toast('✅ Betaling geregistreerd');
  if($(selAmount)) $(selAmount).value = '';
  if($(selNote)) $(selNote).value = '';
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
  const note = $(selNote)?.value?.trim() || '';
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
  if($(selNote)) $(selNote).value = '';
  await after();
}

export async function loadDepositMetrics(){
  // hergebruik loadKPIs zodat de UI consistent blijft
  await loadKPIs();
}

/* ---------- Maand-statistiek ---------- */
export async function loadMonthlyStats(selContainer='#month-stats'){
  if (!$(selContainer)) return; // alleen draaien als er UI voor is

  // drinks per maand (omzet & cogs)
  const { data: drinks } = await supabase
    .from('drinks')
    .select('created_at, sell_price_at_purchase, price_at_purchase');

  // payments per maand
  const { data: pays } = await supabase
    .from('payments').select('created_at, amount');

  // deposits per maand
  const { data: deps } = await supabase
    .from('deposits').select('created_at, amount');

  const monthKey = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  };

  const sums = {};
  (drinks||[]).forEach(d => {
    const k = monthKey(d.created_at);
    sums[k] = sums[k] || { revenue:0, cogs:0, margin:0, payments:0, deposits:0 };
    sums[k].revenue += Number(d.sell_price_at_purchase || 0);
    sums[k].cogs += Number(d.price_at_purchase || 0);
    sums[k].margin = sums[k].revenue - sums[k].cogs;
  });
  (pays||[]).forEach(p => {
    const k = monthKey(p.created_at);
    sums[k] = sums[k] || { revenue:0, cogs:0, margin:0, payments:0, deposits:0 };
    sums[k].payments += Number(p.amount||0);
  });
  (deps||[]).forEach(dp => {
    const k = monthKey(dp.created_at);
    sums[k] = sums[k] || { revenue:0, cogs:0, margin:0, payments:0, deposits:0 };
    sums[k].deposits += Number(dp.amount||0);
  });

  const rows = Object.entries(sums)
    .sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([m, v]) => `
      <tr>
        <td>${esc(m)}</td>
        <td>${euro(v.revenue)}</td>
        <td>${euro(v.cogs)}</td>
        <td>${euro(v.margin)}</td>
        <td>${euro(v.payments)}</td>
        <td>${euro(v.deposits)}</td>
      </tr>`).join('');

  $(selContainer).innerHTML = rows;
}

/* ---------- Transparantie-tabellen ---------- */
export async function loadOpenPerUser(sel='#tbl-open-users'){
  const { data, error } = await supabase
    .from('drinks')
    .select('user_id, users(name), price_at_purchase, paid')
    .or('paid.eq.false,paid.is.null');
  if (error) { console.error(error); return; }

  const map = new Map(); // name -> {amount, count}
  (data||[]).forEach(r => {
    const name = r?.users?.name || 'Onbekend';
    const amt = Number(r?.price_at_purchase || 0);
    const agg = map.get(name) || { amount:0, count:0 };
    agg.amount += amt;
    agg.count += 1;
    map.set(name, agg);
  });

  const rows = Array.from(map.entries())
    .sort((a,b)=> a[0].localeCompare(b[0], 'nl', {sensitivity:'base'}))
    .map(([name, v]) => `<tr><td>${esc(name)}</td><td>${v.count}</td><td>${euro(v.amount)}</td></tr>`)
    .join('');

  if ($(sel)) $(sel).innerHTML = rows || 'Geen data';
}

export async function loadAging(sel='#tbl-aging'){
  const { data, error } = await supabase
    .from('drinks')
    .select('created_at, price_at_purchase, paid')
    .or('paid.eq.false,paid.is.null');
  if (error) { console.error(error); return; }

  const now = Date.now();
  const buckets = { '0–30 dagen':0, '31–60 dagen':0, '61+ dagen':0 };

  (data||[]).forEach(r => {
    const ageDays = Math.floor((now - new Date(r.created_at).getTime()) / 86400000);
    const v = Number(r.price_at_purchase||0);
    if (ageDays <= 30) buckets['0–30 dagen'] += v;
    else if (ageDays <= 60) buckets['31–60 dagen'] += v;
    else buckets['61+ dagen'] += v;
  });

  const rows = Object.entries(buckets)
    .map(([label, amt]) => `<tr><td>${esc(label)}</td><td>${euro(amt)}</td></tr>`)
    .join('');

  if ($(sel)) $(sel).innerHTML = rows || 'Geen data';
}
