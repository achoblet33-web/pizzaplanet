export const TIMEZONE='America/Martinique';
export const OPEN_MINUTES=17*60+30;
export const ORDER_STOP_MINUTES=22*60;
export const CLOSE_MINUTES=22*60+20;
export const BASE_WAIT_MINUTES=15;

export async function ensureProductionSchema(db){
  try{await db.prepare(`DROP TRIGGER IF EXISTS prevent_order_item_for_confirmed_outage`).run()}catch{}
  await db.prepare(`CREATE TABLE IF NOT EXISTS dough_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL DEFAULT 1,
    dough_type TEXT NOT NULL CHECK(dough_type IN ('fine','epaisse')),
    size_code TEXT NOT NULL CHECK(size_code IN ('petite','moyenne','grande')),
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),
    low_threshold INTEGER NOT NULL DEFAULT 5,
    configured INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(restaurant_id,dough_type,size_code)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE,
    printer_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,
    printed_at TEXT,
    last_error TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS printer_state (
    printer_id TEXT PRIMARY KEY,
    last_seen_at TEXT,
    last_result_at TEXT,
    last_success INTEGER,
    last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  for(const sql of [
    `ALTER TABLE orders ADD COLUMN estimated_ready_at TEXT`,
    `ALTER TABLE orders ADD COLUMN printed_at TEXT`
  ]){try{await db.prepare(sql).run()}catch{}}
  const rows=[];
  for(const dough of ['fine','epaisse']) for(const size of ['petite','moyenne','grande'])
    rows.push(db.prepare(`INSERT OR IGNORE INTO dough_stock (restaurant_id,dough_type,size_code,quantity,low_threshold,configured) VALUES (1,?,?,0,5,0)`).bind(dough,size));
  if(rows.length) await db.batch(rows);
}

export function localParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('fr-FR',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const get=t=>parts.find(p=>p.type===t)?.value||'';
  let h=Number(get('hour')); if(h===24)h=0;
  return {hour:h,minute:Number(get('minute')),day:get('day'),month:get('month'),year:get('year')};
}
export function localMinutes(date=new Date()){const p=localParts(date);return p.hour*60+p.minute}
export function formatMartiniqueTime(value){const d=value instanceof Date?value:new Date(value);return new Intl.DateTimeFormat('fr-FR',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit'}).format(d)}
export async function orderingState(db,date=new Date()){
  await ensureProductionSchema(db);
  const restaurant=await db.prepare(`SELECT id,ordering_enabled FROM restaurants ORDER BY id LIMIT 1`).first();
  const m=localMinutes(date);
  const restaurantOpen=m>=OPEN_MINUTES&&m<CLOSE_MINUTES;
  const inOrderHours=m>=OPEN_MINUTES&&m<ORDER_STOP_MINUTES;
  const exceptionalClosed=!restaurant||Number(restaurant.ordering_enabled)!==1;
  return {
    can_order:inOrderHours&&!exceptionalClosed,
    restaurant_open:restaurantOpen,
    exceptional_closed:exceptionalClosed,
    ordering_enabled:!exceptionalClosed,
    open_time:'17:30',
    order_stop_time:'22:00',
    close_time:'22:20'
  };
}
export function clamp(n,min,max){return Math.min(max,Math.max(min,n))}
