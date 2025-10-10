// js/api/finance.js
// Centrale financiële berekeningen & data-aggregatie
// Gebaseerd op jouw schema: users, products, stock_batches, drinks, payments, deposits

import { supabase } from '../supabase.client.js';

/** Kleine helpers (geen DOM in API-laag) */
const toNum = (v) => Number(v ?? 0) || 0;
const sum = (arr, pick = (x) => x) => (arr || []).reduce((s, x) => s + toNum(pick(x)), 0);

// Eenvoudige snapshot-cache zodat meerdere UI-pagina's dezelfde data delen
let _cache = null;
let _cacheTs = 0;
const TTL_MS = 15_000;

/**
 * getFinanceSnapshot
 * Haalt alle relevante tabellen op en berekent kerncijfers.
 * - userId: optioneel filter; als meegegeven, worden drinks/payments gefilterd op gebruiker
 *
 * Belangrijk:
 * - drinks bevat geen prijs → omzet wordt berekend via actuele products.price (1 drink = 1 stuk).
 *   Als je historische prijzen wil, voeg dan 'price_at_sale numeric' toe aan 'drinks' en vul die bij het loggen.
 */
export async function getFinanceSnapshot({ force = false, userId = null } = {}) {
  const now = Date.now();
  if (!force && _cache && (now - _cacheTs) < TTL_MS && _cache.userId === userId) {
    return _cache;
  }

  // Minimal select’s met expliciete kolommen
  const [
    { data: products = [], error: eProducts },
    { data: batches = [], error: eBatches },
    { data: drinks = [], error: eDrinks },
    { data: payments = [], error: ePayments },
    { data: deposits = [], error: eDeposits },
  ] = await Promise.all([
    supabase.from('products').select('id, name, price'),
    supabase.from('stock_batches').select('id, product_id, quantity, price_per_piece, buffer_used, batch_date'),
    supabase.from('drinks').select('id, user_id, product_id, created_at'),
    supabase.from('payments').select('id, user_id, amount, created_at'),
    supabase.from('deposits').select('id, amount, created_at'),
  ]);

  // Foutafhandeling oppervlakkig naar boven bubbelen
  if (eProducts || eBatches || eDrinks || ePayments || eDeposits) {
    throw new Error(
      [
        eProducts && `products: ${eProducts.message}`,
        eBatches && `stock_batches: ${eBatches.message}`,
        eDrinks && `drinks: ${eDrinks.message}`,
        ePayments && `payments: ${ePayments.message}`,
        eDeposits && `deposits: ${eDeposits.message}`,
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }

  // Optionele user-filter
  const drinksRows = userId ? drinks.filter((r) => r.user_id === userId) : drinks;
  const payRows = userId ? payments.filter((r) => r.user_id === userId) : payments;

  // Index voor products lookup
  const productById = new Map(products.map((p) => [p.id, p]));

  // Verkoop (omzet) op basis van #drinks * actuele productprijs
  // NB: Als je price_at_sale later toevoegt, gebruik dan die i.p.v. products.price
  const drinksPerProduct = groupCount(drinksRows, (r) => r.product_id);
  const totalSoldValue = sum([...drinksPerProduct.entries()], ([pid, qty]) => {
    const p = productById.get(pid);
    return toNum(p?.price) * toNum(qty);
  });

  // Totaal betaald
  const totalPaid = sum(payRows, (r) => r.amount);
  const outstanding = totalSoldValue - totalPaid;

  // Koelkastwaarde (retail & kostprijs)
  // - Retail: som(batch.quantity * products.price)
  // - Kost: som(batch.quantity * batch.price_per_piece)
  const fridgeRetail = sum(batches, (b) => {
    const p = productById.get(b.product_id);
    return toNum(p?.price) * toNum(b.quantity);
  });
  const fridgeCost = sum(batches, (b) => toNum(b.quantity) * toNum(b.price_per_piece));

  // Voorgeschoten (jouw definitie): voorraadwaarde + openstaand
  const advancedSpent = fridgeRetail + outstanding;

  // Statiegeldbuffer
  const depositIn = sum(deposits, (r) => r.amount);
  const depositUsed = sum(batches, (r) => r.buffer_used);
  const depositAvailable = depositIn - depositUsed;

  // Verkoop per product (totaal stuks en omzet indicatief met actuele prijs)
  const soldByProduct = [...drinksPerProduct.entries()]
    .map(([product_id, qty]) => {
      const p = productById.get(product_id);
      const name = p?.name || `#${product_id}`;
      const revenue = toNum(p?.price) * toNum(qty);
      return { product_id, name, qty: toNum(qty), revenue };
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

  const result = {
    userId,
    totals: {
      totalSoldValue, // omzet o.b.v. huidige productprijs
      totalPaid,
      outstanding,
      fridgeValue: fridgeRetail, // hoofdwaarde = retail
      fridgeValueCost: fridgeCost, // extra: kostbasis
      advancedSpent,
    },
    deposits: {
      in: depositIn,
      used: depositUsed,
      available: depositAvailable,
    },
    soldByProduct,
    raw: {
      products,
      batches,
      drinks: drinksRows,
      payments: payRows,
      deposits,
    },
  };

  _cache = result;
  _cacheTs = now;
  return result;
}

/** Maandseries voor grafieken: omzet, betalingen, statiegeld */
export function monthlySeries(snapshot) {
  const { products } = snapshot.raw;

  const productById = new Map(products.map((p) => [p.id, p]));

  // omzet uit drinks (qty * huidige productprijs)
  const salesSeries = aggregateMonthly(snapshot.raw.drinks, 'created_at', (r) => {
    const p = productById.get(r.product_id);
    return toNum(p?.price) * 1; // 1 drink = 1 stuk
  });

  const paymentsSeries = aggregateMonthly(snapshot.raw.payments, 'created_at', (r) => toNum(r.amount));
  const depositsSeries = aggregateMonthly(snapshot.raw.deposits, 'created_at', (r) => toNum(r.amount));

  return { salesSeries, paymentsSeries, depositsSeries };
}

/** Na mutaties altijd cache ongeldig maken */
export function invalidateFinanceCache() {
  _cache = null;
  _cacheTs = 0;
}

/* -------------------- interne helpers -------------------- */
function groupCount(rows, keyPick) {
  const m = new Map();
  for (const r of rows || []) {
    const k = keyPick(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function aggregateMonthly(rows, dateKey, valPick) {
  const byMonth = new Map(); // key: YYYY-MM → value: sum
  for (const r of rows || []) {
    const d = new Date(r[dateKey]);
    if (Number.isNaN(d.getTime())) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(k, toNum(byMonth.get(k)) + toNum(valPick(r)));
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));
}
