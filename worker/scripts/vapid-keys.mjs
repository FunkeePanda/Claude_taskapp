// One-shot VAPID key pair generator, run inside the deploy workflow the
// first time only. Prints JSON: { publicKey, privateJWK }. The private
// JWK is piped straight into `wrangler secret put` — never logged,
// never committed. The public key is safe to embed client-side.

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const privateJWK = await crypto.subtle.exportKey('jwk', pair.privateKey);
privateJWK.alg = 'ES256'; // @pushforge/builder expects the alg field set

// VAPID applicationServerKey = base64url of the raw uncompressed point
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const publicKey = Buffer.from(raw).toString('base64url');

console.log(JSON.stringify({ publicKey, privateJWK: JSON.stringify(privateJWK) }));
