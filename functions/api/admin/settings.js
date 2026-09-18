import {json,body} from '../_lib/db.js';
import {ensureProductionSchema,orderingState} from '../_lib/store.js';
export async function onRequest(context){
 const db=context.env.DB;await ensureProductionSchema(db);
 if(context.request.method==='GET'){
  const state=await orderingState(db);
  return json({...state,printer_server_direct_configured:Boolean(context.env.EPSON_PRINTER_ID)});
 }
 if(context.request.method!=='PATCH')return json({error:'Méthode non autorisée'},405,{Allow:'GET, PATCH'});
 const input=await body(context.request);
 if(input.action==='set_ordering'){
  const enabled=input.enabled?1:0;
  await db.prepare(`UPDATE restaurants SET ordering_enabled=? WHERE id=(SELECT id FROM restaurants ORDER BY id LIMIT 1)`).bind(enabled).run();
  return json(await orderingState(db));
 }
 return json({error:'Action invalide'},400);
}
