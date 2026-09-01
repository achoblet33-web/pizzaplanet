export const PENDING_HIDE_MS = 30 * 60 * 1000;
export const PENDING_PURGE_MS = 35 * 60 * 1000;

export function cutoffIdForAge(ageMs, now = Date.now()) {
  return (now - ageMs) * 1000;
}

export async function purgeStalePendingOrders(db, now = Date.now()) {
  const cutoffId = cutoffIdForAge(PENDING_PURGE_MS, now);
  const { results } = await db.prepare(`
    SELECT id
    FROM orders
    WHERE id < ? AND status='new' AND payment_status='pending'
    ORDER BY id
    LIMIT 100
  `).bind(cutoffId).all();

  if (!results?.length) return 0;
  const ids = results.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');

  // order_items n'a pas de ON DELETE CASCADE dans le schéma actuel.
  // On les supprime donc explicitement avant la commande abandonnée.
  await db.batch([
    db.prepare(`DELETE FROM order_items WHERE order_id IN (${placeholders})`).bind(...ids),
    db.prepare(`DELETE FROM orders WHERE id IN (${placeholders}) AND status='new' AND payment_status='pending'`).bind(...ids)
  ]);

  return ids.length;
}
