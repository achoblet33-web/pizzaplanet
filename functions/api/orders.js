import { json } from './_lib/db.js';
export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Méthode non autorisée' }, 405, { Allow: 'GET' });
  return json({ error: 'Liste publique des commandes désactivée' }, 403);
}
