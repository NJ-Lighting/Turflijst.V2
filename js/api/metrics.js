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
      { data: d2,   error: e1 },
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
    // normaliseer join-resultaat
    drinkRows = (drinkRows || []).map(r => ({
      user_id: r.user_id,
      price: (r.products && typeof r.products.price === 'number')
        ? Number(r.products.price) || 0
        : 0,
    }));
  }

  // 3) Reduce → totals / counts per user_id
  const totals = new Map();
  const counts = new Map();

  for (const row of (drinkRows || [])) {
    const u = row.user_id;
    const p = Number(row.price) || 0;
    totals.set(u, (totals.get(u) || 0) + p);
    counts.set(u, (counts.get(u) || 0) + 1);
  }

  // 4) Betalingen per user (som)
  const { data: pays, error: pErr } = await supabase
    .from('payments')
    .select('user_id, amount');
  if (pErr) throw pErr;

  const paid = new Map();
  (pays || []).forEach(p => {
    const amt = Number(p.amount) || 0;
    paid.set(p.user_id, (paid.get(p.user_id) || 0) + amt);
  });

  // 5) Combineer alles
  return (users || []).map(u => {
    const total   = totals.get(u.id) || 0;
    const count   = counts.get(u.id) || 0;
    const paidAmt = paid.get(u.id)   || 0;
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
}
