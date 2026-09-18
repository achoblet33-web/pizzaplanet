import {BASE_WAIT_MINUTES,clamp,ensureProductionSchema} from './store.js';
export const ORDER_CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ORDER_CODE_LENGTH=4;
export const ACTIVE_WINDOW_MS=48*60*60*1000;
export function publicOrderCode(id){let n=BigInt(String(id))%BigInt(ORDER_CODE_ALPHABET.length**ORDER_CODE_LENGTH),out='';for(let i=0;i<ORDER_CODE_LENGTH;i++){out=ORDER_CODE_ALPHABET[Number(n%BigInt(ORDER_CODE_ALPHABET.length))]+out;n/=BigInt(ORDER_CODE_ALPHABET.length)}return out}
export function activeCutoffId(now=Date.now()){return (now-ACTIVE_WINDOW_MS)*1000}
export async function hasStatusEventTable(db){const row=await db.prepare(`SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='order_status_events'`).first();return Boolean(row?.ok)}
export async function recordStatusEvent(db,orderId,status,occurredAt=new Date().toISOString(),source='system'){if(!(await hasStatusEventTable(db)))return false;await db.prepare(`INSERT INTO order_status_events(order_id,status,occurred_at,source) VALUES(?,?,?,?)`).bind(orderId,status,occurredAt,source).run();return true}
export async function averagePreparationMinutes(){return BASE_WAIT_MINUTES}
export async function serviceEstimate(db){
 await ensureProductionSchema(db);
 const cutoff=activeCutoffId();
 const {results:orders}=await db.prepare(`SELECT id,status FROM orders WHERE id>=? AND payment_status='paid' AND status IN ('confirmed','preparing') ORDER BY id`).bind(cutoff).all();
 if(!orders.length)return {average_prep_minutes:15,waiting_orders:0,preparing_orders:0,active_orders:0,active_pizzas:0,estimated_wait_minutes:15,estimated_wait_min:15,estimated_wait_max:15};
 const ids=orders.map(o=>o.id),ph=ids.map(()=>'?').join(',');
 const row=await db.prepare(`SELECT COALESCE(SUM(quantity),0) qty FROM order_items WHERE order_id IN (${ph}) AND (product_id IS NOT NULL OR product_name LIKE '%Pizza%')`).bind(...ids).first();
 const pizzas=Number(row?.qty||0),active=orders.length;
 const extraOrders=Math.max(0,active-2)*4;
 const extraPizzas=Math.max(0,pizzas-6)*2;
 const estimate=clamp(BASE_WAIT_MINUTES+extraOrders+extraPizzas,15,60);
 return {average_prep_minutes:15,waiting_orders:orders.filter(o=>o.status==='confirmed').length,preparing_orders:orders.filter(o=>o.status==='preparing').length,active_orders:active,active_pizzas:pizzas,estimated_wait_minutes:estimate,estimated_wait_min:estimate,estimated_wait_max:estimate};
}
export async function estimateOrder(db,order){
 if(order.status==='ready'||order.status==='completed')return {estimated_minutes_remaining:0,estimated_ready_at:order.estimated_ready_at||order.updated_at};
 if(order.status==='cancelled')return {estimated_minutes_remaining:null,estimated_ready_at:null};
 if(order.estimated_ready_at){
  const remaining=Math.max(0,Math.ceil((Date.parse(order.estimated_ready_at)-Date.now())/60000));
  return {estimated_minutes_remaining:remaining,estimated_ready_at:order.estimated_ready_at};
 }
 const s=await serviceEstimate(db);const ready=new Date(Date.now()+s.estimated_wait_minutes*60000).toISOString();
 return {estimated_minutes_remaining:s.estimated_wait_minutes,estimated_ready_at:ready};
}
