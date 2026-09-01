export function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}})}
export async function body(request){try{return await request.json()}catch{return {}}}
export function requireMethod(request,method){return request.method===method?null:json({error:'Méthode non autorisée'},405,{Allow:method})}

export async function listProducts(env){
 const {results}=await env.DB.prepare(`SELECT p.id,p.name,p.description,p.price_cents,p.active,p.available,c.name category FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1 ORDER BY c.sort_order,p.sort_order,p.name`).all();
 const {results:variants}=await env.DB.prepare(`SELECT id,product_id,size_code,label,price_cents,active FROM product_variants WHERE active=1 ORDER BY product_id,id`).all();
 const {results:capacity}=await env.DB.prepare(`SELECT r.product_id, MIN(CASE WHEN r.quantity>0 THEN i.quantity/r.quantity ELSE 999999 END) capacity, MAX(CASE WHEN i.quantity<=0 AND i.out_of_stock_confirmed=1 THEN 1 ELSE 0 END) confirmed_out FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id GROUP BY r.product_id`).all();
 const cap=new Map(capacity.map(x=>[Number(x.product_id),{capacity:Number(x.capacity),confirmedOut:Boolean(x.confirmed_out)}]));
 return results.map(p=>{const stock=cap.get(Number(p.id))||{capacity:999999,confirmedOut:false};return {...p,available:Boolean(p.available)&&!stock.confirmedOut,stock_capacity:stock.capacity,stock_blocked_by_confirmation:stock.confirmedOut,variants:variants.filter(v=>v.product_id===p.id).map(v=>({...v,active:Boolean(v.active)}))}});
}

export async function getOrderLines(env,orderId){
 const {results}=await env.DB.prepare(`SELECT product_id,quantity FROM order_items WHERE order_id=?`).bind(orderId).all();
 return results;
}

export async function getRecipeRequirements(env,orderId){
 const {results}=await env.DB.prepare(`SELECT r.ingredient_id,i.name,i.unit,i.quantity stock_qty,SUM(r.quantity*oi.quantity) required_qty FROM order_items oi JOIN recipes r ON r.product_id=oi.product_id JOIN ingredients i ON i.id=r.ingredient_id WHERE oi.order_id=? GROUP BY r.ingredient_id,i.name,i.unit,i.quantity`).bind(orderId).all();
 return results;
}
