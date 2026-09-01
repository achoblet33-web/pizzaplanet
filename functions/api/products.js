import { json, requireMethod, listProducts } from './_lib/db.js';

export async function onRequest(context) {
  const methodError = requireMethod(context.request, 'GET');
  if (methodError) return methodError;
  try { return json({ products: await listProducts(context.env) }); }
  catch (e) { return json({ error: 'Impossible de charger le catalogue' }, 500); }
}
