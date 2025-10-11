// /js/api/metrics.js
// Centrale metriek-functies voor alle pagina's.
//
// fetchUserMetrics     → voor Finance/overzichten (all-time drinks/payments)
// fetchUserBalances    → voor Index (toont users.balance, nooit negatief)
// fetchUserDrinkPivot  → pivot (users × producten) voor Index

export async function fetchUserMetrics(supabase) {
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, "WIcreations"')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

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
      (prods || []).map(p => [p.id, Number(p.price) || 0])
    );
    drinkRows = (d2 || []).map(r => ({
      user_id: r.user_id,
      price: priceMap[r.product_id] || 0,
    }));
  } else {
    drinkRows = (drinkRows || []).map(r => ({
      user_id: r.user_id,
      price: (r.products && typeof r.products.price === 'number')
        ? Number(r.products.price) || 0
        : 0,
    }));
  }

  const totals = new Map();
  const counts = new Map();
  for (const row of (drinkRows || [])) {
    const u = row.user_id;
    const p = Number(row.price) || 0;
    totals.set(u, (totals.get(u) || 0) + p);
    counts.set(u, (counts.get(u) || 0) + 1);
  }

  const { data: pays, error: pErr } = await supabase
    .from('payments')
    .select('user_id, amount');
  if (pErr) throw pErr;

  const paid = new Map();
  (pays || []).forEach(p => {
    const amt = Number(p.amount) || 0;
    paid.set(p.user_id, (paid.get(p.user_id) || 0) + amt);
  });

  const rowsOut = (users || []).map(u => {
    const total   = totals.get(u.id) || 0;
    const count   = counts.get(u.id) || 0;
    const paidAmt = paid.get(u.id)   || 0;
    const balance = total - paidAmt;
    return {
      id: u.id,
      name: u.name,
      WIcreations: !!u.WIcreations,
      total, count, paid: paidAmt, balance,
    };
  });

  rowsOut.sort((a,b) =>
    (a.WIcreations !== b.WIcreations)
      ? (a.WIcreations ? -1 : 1)
      : a.name.localeCompare(b.name, 'nl', { sensitivity:'base' })
  );

  return rowsOut;
}

export async function fetchUserBalances(supabase){
  const { data, error } = await supabase
    .from('users')
    .select('id, name, "WIcreations", balance')
    .order('name', { ascending: true });
  if (error) throw error;

  const rows = (data || []).map(u => ({
    id: u.id,
    name: u.name,
    WIcreations: !!u.WIcreations,
    balance: Math.max(0, Number(u.balance || 0)),
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
