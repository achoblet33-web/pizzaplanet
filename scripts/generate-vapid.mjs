import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicJwk = publicKey.export({ format: 'jwk' });
const privateJwk = privateKey.export({ format: 'jwk' });

function b64urlToBuffer(value) {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

const x = b64urlToBuffer(publicJwk.x);
const y = b64urlToBuffer(publicJwk.y);
const rawPublic = Buffer.concat([Buffer.from([4]), x, y]).toString('base64url');

console.log('\nVAPID_PUBLIC_KEY (peut être une variable Cloudflare) :');
console.log(rawPublic);
console.log('\nVAPID_PRIVATE_KEY (SECRET — ne jamais partager ni committer) :');
console.log(privateJwk.d);
console.log('\nAjoutez ces deux valeurs dans Cloudflare Pages, puis redéployez.\n');
