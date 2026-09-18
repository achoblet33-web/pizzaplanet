import {json,body} from '../_lib/db.js';
import {ensureProductionSchema} from '../_lib/store.js';
export async function onRequest(context){
 const db=context.env.DB;await ensureProductionSchema(db);
 if(context.request.method==='GET'){
  const {results}=await db.prepare(`SELECT id,dough_type,size_code,quantity,low_threshold,configured,updated_at FROM dough_stock ORDER BY CASE dough_type WHEN 'fine' THEN 0 ELSE 1 END,CASE size_code WHEN 'petite' THEN 0 WHEN 'moyenne' THEN 1 ELSE 2 END`).all();
  return json({stocks:results.map(r=>({...r,configured:Boolean(r.configured),low:Boolean(r.configured)&&Number(r.quantity)<=Number(r.low_threshold)}))});
 }
 if(context.request.method!=='PATCH')return json({error:'Méthode non autorisée'},405,{Allow:'GET, PATCH'});
 const input=await body(context.request),qty=Number(input.quantity),threshold=Number(input.low_threshold??5);
 if(!input.id||!Number.isInteger(qty)||qty<0||!Number.isInteger(threshold)||threshold<0)return json({error:'Stock invalide'},400);
 await db.prepare(`UPDATE dough_stock SET quantity=?,low_threshold=?,configured=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(qty,threshold,input.id).run();
 return json({ok:true});
}
