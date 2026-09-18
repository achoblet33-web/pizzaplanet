import {json} from './_lib/db.js';
import {serviceEstimate} from './_lib/tracking.js';
import {orderingState} from './_lib/store.js';
export async function onRequest(context){
 if(context.request.method!=='GET')return json({error:'Méthode non autorisée'},405,{Allow:'GET'});
 const [estimate,state]=await Promise.all([serviceEstimate(context.env.DB),orderingState(context.env.DB)]);
 return json({...state,...estimate,payments_configured:Boolean(context.env.STRIPE_SECRET_KEY),updated_at:new Date().toISOString()});
}
