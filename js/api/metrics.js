// /js/api/metrics.js
// Centrale metriek-functies voor alle pagina's.

/**
 * Volledige metriek per user:
 * - total: som van price_at_purchase (historische prijs) van alle open drinks
 * - paid: som van alle payments.amount (positief=betaling, negatief=refund/correctie)
 * - balance: total - paid (positief = nog te betalen; kan negatief zijn bij teveel betaald)
 * - count: aantal drinks
 */
export async function fetchUserMetrics(supabase) {
  // 1) Users
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, name, "WIcreations"')
    .order('name', { ascending: true });
  if (uErr) throw uErr;

  // 2) Drankjes (historische prijs op moment van aankoop)
  const { data: drinks, error: dErr } = await supabase
    .from('drinks')
    .select('user_id, price_at_purchase');
  if (dErr) throw dErr;

  const totals = new Map(); // user_id -> som(prijs)
  const counts = new Map(); // user_id -> aantal
  for (const r of (drinks || [])) {
    const uid = r.user_id;
    const price = toNumber(r?.price_at_purchase);
    totals.set(uid, (totals.get(uid) || 0) + price);
    counts.set(uid, (counts.get(uid) || 0) + 1);
  }

  // 3) Betalingen (positief = betaling, negatief = refund/correctie)
  const { data: pays, error: pErr } = await supabase
    .from('payments')
    .select('user_id, amount');
  if (pErr) throw pErr;

  const paidSum = new Map(); // user_id -> som(amount)
  for (const p of (pays || [])) {
    const a = toNumber(p?.amount);
    paidSum.set(p.user_id, (paidSum.get(p.user_id) || 0) + a);
  }

  // 4) Output per user
  const rowsOut = (users || []).map(u => {
    const total = totals.get(u.id) ?? 0;
    const count = counts.get(u.id) ?? 0;
    const paid  = paidSum.get(u.id) ?? 0;
    const balance = total - paid; // positief = nog te betalen
    return {
      id: u.id,
      name: u.name,
      WIcreations: !!u.WIcreations,
      total,
      count,
      paid,      // kan negatief zijn als refunds groter dan betalingen
      balance    // kan negatief zijn (te veel betaald); UI kan clampen
    };
  });

  rowsOut.sort((a, b) => {
    if (a.WIcreations !== b.WIcreations) return a.WIcreations ? -1 : 1;
    return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
  });

  return rowsOut;
}

/**
 * UI-geschikte balans: balance wordt geclamped naar >= 0.
 * Gebruik dit voor overzichten waar je alleen 'te betalen' wilt tonen.
 */
export async function fetchUserBalances(supabase) {
  const metrics = await fetchUserMetrics(supabase);
  const rows = (metrics || []).map(m => ({
    id: m.id,
    name: m.name,
    WIcreations: !!m.WIcreations,
    balance: Math.max(0, toNumber(m.balance)),
  }));
  rows.sort((a, b) => {
    if (a.WIcreations !== b.WIcreations) return a.WIcreations ? -1 : 1;
    return a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
  });
  return rows;
}

/**
 * Snelle helper: Map<user_id, balance>=0 voor directe lookup.
 */
export async function fetchUserBalancesMap(supabase) {
  const rows = await fetchUserBalances(supabase);
  const map = new Map();
  for (const r of rows) map.set(r.id, r.balance);
  return map;
}

/**
 * Pivottabel: gebruikers x producten met aantallen.
 */
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

  const out = users.map(u => ({
    user: u,
    counts: products.map(p => usersMap.get(u).get(p) || 0)
  }));

  return { products, rows: out };
}

/**
 * Totals per user op basis van price_at_purchase (historische prijs).
 * (Naam-gebaseerd; vooral voor grafieken/exports.)
 */
export async function fetchUserTotalsCurrentPrice(supabase) {
  const { data, error } = await supabase
    .from('drinks')
    .select('users(name), price_at_purchase');
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

// helper
function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
