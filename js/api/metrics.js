// /js/api/metrics.js
// Centrale metriek-functies voor alle pagina's.
//
// Returned per gebruiker:
// - total:   som van prijzen van gelogde drankjes (op basis van actuele productprijs)
// - count:   aantal gelogde drankjes
// - paid:    som van geregistreerde betalingen
// - balance: total - paid
// - WIcreations: boolean (voor UI-sorting/labeling)
export async function fetchUserMetrics(supabase) {
  // 1) Users (incl. WIcreations-vlag zoals V1)
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, "WIcreations"')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  // 2) Drinks + price (join). Als join faalt (bv. permissies), fallback met extra query.
  let drinkRows = [];
  let joinError = null;
  try {
    const { data, error } = await supabase
      .from('drinks')
      .select('user_id, product_id, products(price)');
    joinError = error;
    if (!error && data) drinkRows = data;
  } catch (e) {
    joinError = e;
  }

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
    // normaliseer join-resultaat
    drinkRows = (drinkRows || []).map(r => ({
      user_id: r.user_id,
      price: toNumber(r?.products?.price),
    }));
  }

  // 3) Reduce → totals / counts per user_id
  const totals = new Map();
  const counts = new Map();
  for (const row of (drinkRows || [])) {
    const u = row.user_id;
    const p = toNumber(row.price);
    totals.set(u, (totals.get(u) || 0) + p);
    counts.set(u, (counts.get(u) || 0) + 1);
  }

  // 4) Betalingen per user (som). Bij RLS-issues → treated as 0 (geen throw).
  let pays = [];
  try {
    const res = await supabase.from('payments').select('user_id, amount');
    if (res.error) throw res.error;
    pays = res.data || [];
  } catch {
    pays = [];
  }
  const paid = new Map();
  for (const p of pays) {
    const amt = toNumber(p?.amount);
    paid.set(p.user_id, (paid.get(p.user_id) || 0) + amt);
  }

  // 5) Combineer alles
  const rowsOut = (users || []).map(u => {
    const total   = totals.get(u.id) ?? 0;
    const count   = counts.get(u.id) ?? 0;
    const paidAmt = paid.get(u.id)   ?? 0;
    const balance = total - paidAmt;
    return {
      id: u.id,
      name: u.name,
      WIcreations: !!u.WIcreations,
      total,
      count,
      paid: paidAmt,
      balance,
    };
  });

  // WIcreations bovenaan, daarna alfabetisch op naam
  rowsOut.sort((a, b) => {
    if (a.WIcreations !== b.WIcreations) return a.WIcreations ? -1 : 1;
    return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
  });

  return rowsOut;
}

// -------- Helpers --------
function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
