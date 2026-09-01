import { json, body } from '../_lib/db.js';

async function catalog(db) {
  const { results } = await db.prepare(`SELECT p.id,p.name,p.description,p.price_cents,p.active,p.available,p.sort_order,p.category_id,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY c.sort_order,p.sort_order,p.name`).all();
  const { results: variants } = await db.prepare(`SELECT id,product_id,size_code,label,price_cents,active FROM product_variants ORDER BY product_id,id`).all();
  const { results: ingredients } = await db.prepare(`SELECT id,name,unit,quantity,low_threshold FROM ingredients ORDER BY name`).all();
  const { results: recipes } = await db.prepare(`SELECT product_id,ingredient_id,quantity FROM recipes`).all();
  return { products: results.map(p=>({...p,active:!!p.active,available:!!p.available,variants:variants.filter(v=>v.product_id===p.id).map(v=>({...v,active:!!v.active})),recipe:recipes.filter(r=>r.product_id===p.id)})), ingredients };
}

export async function onRequest(context) {
  const db=context.env.DB;
  if(context.request.method==='GET') return json(await catalog(db));
  if(context.request.method!=='PATCH' && context.request.method!=='POST') return json({error:'Méthode non autorisée'},405,{Allow:'GET, POST, PATCH'});
  const input=await body(context.request);
  try {
    if(context.request.method==='POST') {
      if(input.type==='product') {
        if(!input.name?.trim()) return json({error:'Nom requis'},400);
        const restaurant=await db.prepare('SELECT id FROM restaurants ORDER BY id LIMIT 1').first();
        const r=await db.prepare(`INSERT INTO products (restaurant_id,category_id,name,description,price_cents,active,available,sort_order) VALUES (?,?,?,?,?,?,?,?)`).bind(restaurant?.id||1,input.category_id||null,input.name.trim(),input.description||'',Math.round(Number(input.price_cents)||0),1,1,Number(input.sort_order)||0).run();
        return json({id:r.meta.last_row_id},201);
      }
      if(input.type==='variant') { await db.prepare(`INSERT INTO product_variants (product_id,size_code,label,price_cents,active) VALUES (?,?,?,?,1)`).bind(input.product_id,input.size_code,input.label,Math.round(Number(input.price_cents)||0)).run(); return json({ok:true},201); }
      if(input.type==='ingredient') { if(!input.name?.trim()) return json({error:'Nom requis'},400); const restaurant=await db.prepare('SELECT id FROM restaurants ORDER BY id LIMIT 1').first(); const r=await db.prepare(`INSERT INTO ingredients (restaurant_id,name,unit,quantity,low_threshold) VALUES (?,?,?,?,?)`).bind(restaurant?.id||1,input.name.trim(),input.unit||'g',Number(input.quantity)||0,Number(input.low_threshold)||0).run(); return json({id:r.meta.last_row_id},201); }
      if(input.type==='recipe') { await db.prepare(`INSERT INTO recipes(product_id,ingredient_id,quantity) VALUES(?,?,?) ON CONFLICT(product_id,ingredient_id) DO UPDATE SET quantity=excluded.quantity`).bind(input.product_id,input.ingredient_id,Number(input.quantity)).run(); return json({ok:true},201); }
    }
    if(input.type==='product') await db.prepare(`UPDATE products SET name=?,description=?,price_cents=?,active=?,available=?,category_id=?,sort_order=? WHERE id=?`).bind(input.name,input.description||'',Math.round(Number(input.price_cents)||0),input.active?1:0,input.available?1:0,input.category_id||null,Number(input.sort_order)||0,input.id).run();
    if(input.type==='variant') await db.prepare(`UPDATE product_variants SET label=?,price_cents=?,active=? WHERE id=?`).bind(input.label,Math.round(Number(input.price_cents)||0),input.active?1:0,input.id).run();
    if(input.type==='ingredient') await db.prepare(`UPDATE ingredients SET name=?,unit=?,quantity=?,low_threshold=? WHERE id=?`).bind(input.name,input.unit,Number(input.quantity)||0,Number(input.low_threshold)||0,input.id).run();
    return json({ok:true});
  } catch(e) { return json({error:'Opération catalogue impossible'},400); }
}
