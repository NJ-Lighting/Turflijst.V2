// /js/api/metrics.js
// Centrale metriek-functies voor alle pagina's.
//
// fetchUserMetrics: per gebruiker total, count, paid, balance, WIcreations
// fetchUserDrinkPivot: volledige pivot-tabel (productenlijst + rijen met counts)

export async function fetchUserMetrics(supabase) {
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, "WIcreations"')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  // Drinks + price (join) met fallback
  let drinkRows = [];
  let joinError = null;
  try {
    const { data, error } = await supabase
      .from('drinks')
      .select('user_id, product_id, products(price)');
    joinError = error;
    if (!error && data) drinkRows = data;
  } catch (e) { joinError = e; }

  if (joinError) {
    const [
      { data: d2, error: e1 },
      { data: prods, error: e2 },
    ] = await Promise.all([
      supabase.from('drinks').select('user_id, product_id'),
      supabase.from('products').select('id, price'),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    const priceMap = Object.fromEntries(
      (prods || []).map(p => [p.id, toNumber(p.price)])
    );

    drinkRows = (d2 || []).map(r => ({
      user_id: r.user_id,
      price: priceMap[r.product_id] ?? 0,
    }));
  } else {
    drinkRows = (drinkRows || []).map(r => ({
      user_id: r.user_id,
      price: toNumber(r?.products?.price),
    }));
  }

  // Reduce → totals / counts per user_id
  const totals = new Map();
  const counts = new Map();
  for (const row of (drinkRows || [])) {
    const u = row.user_id;
    const p = toNumber(row.price);
    totals.set(u, (totals.get(u) || 0) + p);
    counts.set(u, (counts.get(u) || 0) + 1);
  }

  // Betalingen (zachte fallback bij RLS)
  let pays = [];
  try {
    const res = await supabase.from('payments').select('user_id, amount');
    if (res.error) throw res.error;
    pays = res.data || [];
  } catch { pays = []; }
  const paid = new Map();
  for (const p of pays) {
    const amt = toNumber(p?.amount);
    paid.set(p.user_id, (paid.get(p.user_id) || 0) + amt);
  }

  // Combineer
  const rowsOut = (users || []).map(u => ({
    id: u.id,
    name: u.name,
    WIcreations: !!u.WIcreations,
    total:   totals.get(u.id) ?? 0,
    count:   counts.get(u.id) ?? 0,
    paid:    paid.get(u.id)   ?? 0,
    balance: (totals.get(u.id) ?? 0) - (paid.get(u.id) ?? 0),
  }));

  // Sortering
  rowsOut.sort((a,b) => (a.WIcreations !== b.WIcreations)
    ? (a.WIcreations ? -1 : 1)
    : a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));

  return rowsOut;
}

// Pivot: producten (kolommen) + rows = [{user, counts:[…]}]
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
  const users    = Array.from(usersMap.keys()).sort(coll.compare);

  const outRows = users.map(u => ({
    user: u,
    counts: products.map(p => usersMap.get(u).get(p) || 0),
  }));

  return { products, rows: outRows };
}

function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }
