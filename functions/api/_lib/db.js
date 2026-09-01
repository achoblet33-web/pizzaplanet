export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}
export async function body(request) { try { return await request.json(); } catch { return {}; } }
export function requireMethod(request, method) { return request.method === method ? null : json({ error: 'Méthode non autorisée' }, 405, { Allow: method }); }
export async function listProducts(env) {
  const { results } = await env.DB.prepare(`SELECT p.id,p.name,p.description,p.price_cents,p.active,p.available,c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY c.sort_order,p.sort_order,p.name`).all();
  return results.map(p => ({ ...p, available: Boolean(p.available) }));
}
