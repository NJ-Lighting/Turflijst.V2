// /js/api/metrics.js
// Centrale metriek-functies voor alle pagina's

/**
 * Haal per gebruiker de totaalprijs (total) en het aantal drankjes (count) op.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Array<{id:string,name:string,total:number,count:number}>>}
 */
export async function fetchUserMetrics(supabase){
  // 1) Users
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  // 2) Drinks + price (join) met fallback
  let drinkRows = [];
  let joinError = null;
  try {
    const { data, error } = await supabase
      .from('drinks')
      .select('user_id, product_id, products(price)');
    joinError = error;
    if (!error && data) drinkRows = data;
  } catch(e){ joinError = e; }

  if (joinError) {
    const [{ data: d2, error: e1 }, { data: prods, error: e2 }] = await Promise.all([
      supabase.from('drinks').select('user_id, product_id'),
      supabase.from('products').select('id, price')
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const priceMap = Object.fromEntries((prods || []).map(p => [p.id, p.price || 0]));
    drinkRows = (d2 || []).map(r => ({ user_id: r.user_id, price: priceMap[r.product_id] || 0 }));
  } else {
    drinkRows = (drinkRows || []).map(r => ({
      user_id: r.user_id,
      price: (r.products && typeof r.products.price === 'number') ? r.products.price : 0
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

  // 4) Combineer met users
  return (users || []).map(u => ({
    id: u.id,
    name: u.name,
    total: totals.get(u.id) || 0,
    count: counts.get(u.id) || 0,
  }));
}
