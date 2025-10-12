// /js/api/metrics.js
export async function fetchUserMetrics(supabase) {
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, "WIcreations"')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  // Alleen ONBETAALD (paid=false of NULL), historische prijs
  const { data: drinks, error: dErr } = await supabase
    .from('drinks')
    .select('user_id, price_at_purchase, paid')
    .or('paid.eq.false,paid.is.null');
  if (dErr) throw dErr;

  const totals = new Map();
  const counts = new Map();
  for (const r of (drinks || [])) {
    const uid = r.user_id;
    const price = toNumber(r?.price_at_purchase);
    totals.set(uid, (totals.get(uid) || 0) + price);
    counts.set(uid, (counts.get(uid) || 0) + 1);
  }

  const { data: pays, error: pErr } = await supabase
    .from('payments')
    .select('user_id, amount');
  if (pErr) throw pErr;

  const paidSum = new Map();
  for (const p of (pays || [])) {
    const a = toNumber(p?.amount);
    paidSum.set(p.user_id, (paidSum.get(p.user_id) || 0) + a);
  }

  const rowsOut = (users || []).map(u => {
    const total = totals.get(u.id) ?? 0;   // onbetaald
    const count = counts.get(u.id) ?? 0;   // onbetaald
    const paid  = paidSum.get(u.id) ?? 0;  // som payments
    const balance = total - paid;
    return { id: u.id, name: u.name, WIcreations: !!u.WIcreations, total, count, paid, balance };
  });

  console.log('[metrics] totals sample:', rowsOut.slice(0,3));

  rowsOut.sort((a, b) => {
    if (a.WIcreations !== b.WIcreations) return a.WIcreations ? -1 : 1;
    return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
  });

  return rowsOut;
}

export async function fetchUserBalances(supabase) {
  const metrics = await fetchUserMetrics(supabase);
  const rows = (metrics || []).map(m => ({
    id: m.id, name: m.name, WIcreations: !!m.WIcreations,
    balance: Math.max(0, toNumber(m.balance)),
  }));
  rows.sort((a, b) => {
    if (a.WIcreations !== b.WIcreations) return a.WIcreations ? -1 : 1;
    return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
  });
  return rows;
}

export async function fetchUserDrinkPivot(supabase) {
  const { data: rows, error } = await supabase
    .from('drinks')
    .select('user_id, users(name), products(name)');
  if (error) throw error;

  const usersMap = new Map();
  const productSet = new Set();
  for (const r of (rows || [])) {
    const user = r?.users?.name || 'Onbekend';
    const prod = r?.products?.name || 'Onbekend';
    productSet.add(prod);
    if (!usersMap.has(user)) usersMap.set(user, new Map());
    const m = usersMap.get(user);
    m.set(prod, (m.get(prod) || 0) + 1);
  }

  const coll = new Intl.Collator('nl', { sensitivity: 'base', numeric: true });
  const products = Array.from(productSet).sort(coll.compare);
  const users = Array.from(usersMap.keys()).sort(coll.compare);
  const out = users.map(u => ({ user: u, counts: products.map(p => usersMap.get(u).get(p) || 0) }));
  return { products, rows: out };
}

export async function fetchUserTotalsCurrentPrice(supabase) {
  const { data, error } = await supabase
    .from('drinks')
    .select('users(name), price_at_purchase, paid')
    .or('paid.eq.false,paid.is.null');
  if (error) throw error;

  const totals = new Map();
  for (const r of (data || [])) {
    const name = r?.users?.name || 'Onbekend';
    const price = toNumber(r?.price_at_purchase);
    totals.set(name, (totals.get(name) || 0) + price);
  }

  const rows = Array.from(totals.entries()).map(([name, amount]) => ({ name, amount }));
  rows.sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
  return rows;
}

function toNumber(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
