import {json,body} from '../_lib/db.js';
import {ensureProductionSchema,orderingState} from '../_lib/store.js';

export async function onRequest(context){
 const db=context.env.DB;await ensureProductionSchema(db);
 if(context.request.method==='GET'){
  const state=await orderingState(db);
  const printerId=context.env.EPSON_PRINTER_ID||'';
  const tokenConfigured=Boolean(context.env.EPSON_SDP_TOKEN);
  const printer=printerId?await db.prepare(`SELECT printer_id,last_seen_at,last_result_at,last_success,last_error,updated_at FROM printer_state WHERE printer_id=?`).bind(printerId).first():null;
  const pending=await db.prepare(`SELECT COUNT(*) n FROM print_jobs WHERE status IN ('pending','sent','error')`).first();
  const now=Date.now(),seen=printer?.last_seen_at?Date.parse(printer.last_seen_at):0;
  const online=Boolean(seen&&now-seen<120000);
  return json({
    ...state,
    printer_server_direct_configured:Boolean(printerId&&tokenConfigured),
    printer:{
      configured:Boolean(printerId&&tokenConfigured),
      printer_id:printerId||null,
      online,
      last_seen_at:printer?.last_seen_at||null,
      last_result_at:printer?.last_result_at||null,
      last_success:printer?.last_success==null?null:Boolean(printer.last_success),
      last_error:printer?.last_error||null,
      pending_jobs:Number(pending?.n||0)
    }
  });
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
