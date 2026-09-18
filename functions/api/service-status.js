import { json } from './_lib/db.js';
import { serviceEstimate } from './_lib/tracking.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET' });
  const estimate = await serviceEstimate(context.env.DB);
  return json({
    ...estimate,
    updated_at: new Date().toISOString()
  });
}
