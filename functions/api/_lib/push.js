const encoder = new TextEncoder();

function concat(...parts) {
  const arrays = parts.map(p => p instanceof Uint8Array ? p : new Uint8Array(p));
  const total = arrays.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of arrays) { out.set(part, offset); offset += part.length; }
  return out;
}

function b64urlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function b64urlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlJson(value) {
  return b64urlEncode(encoder.encode(JSON.stringify(value)));
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

async function hkdfExpand(prk, info, length) {
  let previous = new Uint8Array();
  let result = new Uint8Array();
  let counter = 1;
  while (result.length < length) {
    previous = await hmac(prk, concat(previous, info, new Uint8Array([counter++])));
    result = concat(result, previous);
  }
  return result.slice(0, length);
}

async function encryptPayload(subscription, payload) {
  const uaPublic = b64urlDecode(subscription.p256dh);
  const authSecret = b64urlDecode(subscription.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Clés Web Push invalides');

  const sender = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const receiverPublic = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverPublic }, sender.privateKey, 256));

  const prkKey = await hmac(authSecret, sharedSecret);
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, senderPublic);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, encoder.encode('Content-Encoding: nonce\0'), 12);

  const plaintext = concat(encoder.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([senderPublic.length]), senderPublic, ciphertext);
}

async function vapidAuthorization(endpoint, env) {
  const rawPublic = b64urlDecode(env.VAPID_PUBLIC_KEY);
  if (rawPublic.length !== 65 || rawPublic[0] !== 4) throw new Error('VAPID_PUBLIC_KEY invalide');
  const x = b64urlEncode(rawPublic.slice(1, 33));
  const y = b64urlEncode(rawPublic.slice(33, 65));
  const privateD = String(env.VAPID_PRIVATE_KEY || '');
  if (!privateD) throw new Error('VAPID_PRIVATE_KEY absent');

  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x, y, d: privateD, ext: true, key_ops: ['sign']
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const subject = env.VAPID_SUBJECT || 'https://pizzaplanet-b8z.pages.dev/';
  const unsigned = `${b64urlJson({ typ: 'JWT', alg: 'ES256' })}.${b64urlJson({ aud, exp: now + 12 * 60 * 60, sub: subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)));
  const jwt = `${unsigned}.${b64urlEncode(signature)}`;
  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

export async function sendWebPush(env, subscription, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { ok: false, configured: false, status: 0 };
  const body = await encryptPayload(subscription, payload);
  const authorization = await vapidAuthorization(subscription.endpoint, env);
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high'
    },
    body
  });
  return { ok: response.ok, configured: true, status: response.status };
}

const STATUS_MESSAGES = {
  preparing: { title: '🔥 Commande en préparation', body: 'Planet Pizza a pris votre commande en charge et commence sa préparation.' },
  ready: { title: '✅ Votre commande est prête', body: 'Vous pouvez venir retirer votre commande chez Planet Pizza.' },
  completed: { title: '🤝 Commande remise', body: 'Votre commande a été remise. Merci et bon appétit !' },
  cancelled: { title: '⚠️ Commande annulée', body: 'Votre commande a été annulée. Contactez Planet Pizza si nécessaire.' }
};

export async function notifyOrderSubscribers(db, env, orderId, code, status, etaMinutes = null) {
  const message = STATUS_MESSAGES[status];
  if (!message || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { sent: 0, configured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) };
  const { results } = await db.prepare(`SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE order_id=?`).bind(orderId).all();
  let sent = 0;
  for (const row of results || []) {
    try {
      const eta = (status === 'preparing' && Number.isFinite(Number(etaMinutes))) ? ` Temps estimé : environ ${etaMinutes} min.` : '';
      const result = await sendWebPush(env, row, {
        title: `${message.title} · ${code}`,
        body: `${message.body}${eta}`,
        status,
        code,
        url: `/suivi.html?code=${encodeURIComponent(code)}`
      });
      if (result.ok) sent++;
      if (result.status === 404 || result.status === 410) {
        await db.prepare(`DELETE FROM push_subscriptions WHERE id=?`).bind(row.id).run();
      }
    } catch {}
  }
  return { sent, configured: true };
}
