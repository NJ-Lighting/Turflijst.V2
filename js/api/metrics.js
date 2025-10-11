// /js/api/metrics.js
// Centrale metriek-functies voor alle pagina's.
//
// fetchUserMetrics     → voor Finance/overzichten (all-time drinks/payments)
// fetchUserBalances    → voor Index (via metrics; nooit negatief tonen)
// fetchUserDrinkPivot  → pivot (users × producten) voor Index

export async function fetchUserMetrics(supabase) {
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, "WIcreations"')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  // 2) Drankjes met voorkeur voor 'snapshot' prijs (drinks.price)
  let drinkRows = [];
  let haveSnapshot = false;

  const shot = await supabase
    .from('drinks')
    .select('user_id, price');
  if (!shot.error && Array.isArray(shot.data)) {
    haveSnapshot = true;
    drinkRows = shot.data.map(r => ({ user_id: r.user_id, price: toNumber(r?.price) }));
  } else {
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
  }

  // Reduce totals / counts
  const totals = new Map();
  const counts = new Map();
  for (const row of (drinkRows || [])) {
    const u = row.user_id;
    const p = toNumber(row.price);
    totals.set(u, (totals.get(u) || 0) + p);
    counts.set(u, (counts.get(u) || 0) + 1);
  }

  // Betalingen → som van absolute bedragen (betaling is reeds betaald)
  const { data: pays, error: pErr } = await supabase
    .from('payments')
    .select('user_id, amount');
  if (pErr) throw pErr;

  const paid = new Map();
  for (const p of (pays || [])) {
    const amt = Math.abs(toNumber(p?.amount));
    paid.set(p.user_id, (paid.get(p.user_id) || 0) + amt);
  }

  // Combineer
  const rowsOut = (users || []).map(u => {
    const total   = totals.get(u.id) ?? 0;
    const count   = counts.get(u.id) ?? 0;
    const paidAmt = paid.get(u.id)   ?? 0;
    const balance = total - paidAmt;
    return {
      id: u.id,
      name: u.name,
      WIcreations: !!u.WIcreations,
      total, count, paid: paidAmt, balance,
    };
  });

  // Sortering
  rowsOut.sort((a,b) =>
    (a.WIcreations !== b.WIcreations)
      ? (a.WIcreations ? -1 : 1)
      : a.name.localeCompare(b.name, 'nl', { sensitivity:'base' })
  );

  return rowsOut;
}

export async function fetchUserBalances(supabase){
  // Altijd via metrics (die snapshot-prijs prefereert); index toont nooit < 0
  const metrics = await fetchUserMetrics(supabase);
  const rows = (metrics || []).map(m => ({
    id: m.id,
    name: m.name,
    WIcreations: !!m.WIcreations,
    balance: Math.max(0, toNumber(m.balance)),
  }));
  rows.sort((a,b) =>
    (a.WIcreations !== b.WIcreations)
      ? (a.WIcreations ? -1 : 1)
      : a.name.localeCompare(b.name, 'nl', { sensitivity:'base' })
  );
  return rows;
}

export async function fetchUserDrinkPivot(supabase){
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

  const coll = new Intl.Collator('nl', { sensitivity:'base', numeric:true });
  const products = Array.from(productSet).sort(coll.compare);
  const users    = Array.from(usersMap.keys()).sort(coll.compare);

  const out = users.map(u => ({
    user: u,
    counts: products.map(p => usersMap.get(u).get(p) || 0),
  }));

  return { products, rows: out };
}

// helper
function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : 0; }
