import { json } from '../_lib/db.js';

export async function onRequest(context){
  if(context.request.method!=='GET')return json({error:'Méthode non autorisée'},405,{Allow:'GET'});
  const publicKey=String(context.env.VAPID_PUBLIC_KEY||'');
  return json({configured:Boolean(publicKey&&context.env.VAPID_PRIVATE_KEY),public_key:publicKey||null});
}
