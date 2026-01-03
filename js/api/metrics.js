// /js/api/metrics.js
export async function fetchUserMetrics(supabase) {
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, "WIcreations"')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  // Alleen drankjes die NOG NIET betaald zijn
  const { data: drinks, error: dErr } = await supabase
    .from('drinks')
    .select('user_id, price_at_purchase')
    .eq('paid', false);
  if (dErr) throw dErr;

  const totals = new Map();
  const counts = new Map();

  for (const r of (drinks || [])) {
    const uid = r.user_id;
    const price = toNumber(r?.price_at_purchase);
    totals.set(uid, (totals.get(uid) || 0) + price);
    counts.set(uid, (counts.get(uid) || 0) + 1);
  }

  const rowsOut = (users || []).map(u => {
    const total = totals.get(u.id) ?? 0;
    const count = counts.get(u.id) ?? 0;

    return {
      id: u.id,
      name: u.name,
      WIcreations: !!u.WIcreations,
      total,
      count,
      balance: total
    };
  });

  rowsOut.sort((a, b) => {
    if (a.WIcreations !== b.WIcreations) return a.WIcreations ? -1 : 1;
    return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
  });

  return rowsOut;
}

export async function fetchUserBalances(supabase) {
  const metrics = await fetchUserMetrics(supabase);

  const rows = await Promise.all(
    (metrics || []).map(async m => {
      const openSinceLastPayment =
        await fetchOpenSinceLastPayment(supabase, m.id);

      const total = toNumber(m.balance);
      const since = toNumber(openSinceLastPayment);

      return {
        id: m.id,
        name: m.name,
        WIcreations: !!m.WIcreations,

        // 🔑 HOOFDREGEL = bedrag van de betaalpoging
        balance: Math.max(0, total - since),

        // 🔑 SUBREGEL = alles NA de betaalpoging
        openSinceLastPayment: Math.max(0, since),
      };
    })
  );

  rows.sort((a, b) => {
    if (a.WIcreations !== b.WIcreations) return a.WIcreations ? -1 : 1;
    return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
  });

  return rows;
}

export async function fetchUserDrinkPivot(supabase) {
  const { data: rows, error } = await supabase
    .from('drinks')
    .select('user_id, users(name), products(name)')
    .eq('paid', false);
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

  const out = users.map(u => ({
    user: u,
    counts: products.map(p => usersMap.get(u).get(p) || 0)
  }));

  return { products, rows: out };
}

export async function fetchUserTotalsCurrentPrice(supabase) {
  const { data, error } = await supabase
    .from('drinks')
    .select('users(name), price_at_purchase')
    .eq('paid', false);
  if (error) throw error;

  const totals = new Map();

  for (const r of (data || [])) {
    const name = r?.users?.name || 'Onbekend';
    const price = toNumber(r?.price_at_purchase);
    totals.set(name, (totals.get(name) || 0) + price);
  }

  const rows = Array.from(totals.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));

  return rows;
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchLastPaymentAt(supabase, userId) {
  const { data, error } = await supabase
    .from('payments')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[fetchLastPaymentAt]', error);
    return null;
  }

  return data?.created_at || null;
}

export async function fetchOpenSinceLastPayment(supabase, userId) {
  const lastPaidAt = await fetchLastPaymentAt(supabase, userId);

  let q = supabase
    .from('drinks')
    .select('price_at_purchase')
    .eq('user_id', userId)
    .eq('paid', false);

  if (lastPaidAt) {
    q = q.gt('created_at', lastPaidAt);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[fetchOpenSinceLastPayment]', error);
    return 0;
  }

  return (data || []).reduce(
    (sum, r) => sum + Number(r.price_at_purchase || 0),
    0
  );
}
