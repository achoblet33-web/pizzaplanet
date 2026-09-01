export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
  });
}

export async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export function requireMethod(request, method) {
  if (request.method !== method) return json({ error: 'Méthode non autorisée' }, 405, { Allow: method });
  return null;
}

export async function listProducts(env) {
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.name, p.description, p.category, p.price_cents, p.available,
           COALESCE((SELECT MIN(i.stock_qty / NULLIF(ri.qty_required, 0))
                     FROM recipe_items ri JOIN ingredients i ON i.id = ri.ingredient_id
                     WHERE ri.product_id = p.id), 999999) AS stock_capacity
    FROM products p WHERE p.active = 1 ORDER BY p.category, p.sort_order, p.name
  `).all();
  return results.map(p => ({ ...p, available: Boolean(p.available) && Number(p.stock_capacity) > 0 }));
}

export async function getOrder(env, id) {
  return env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(id).first();
}
