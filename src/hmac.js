// HMAC-SHA256 signing/verification for x-agent-games-signature.
// The platform signs the RAW request body; we sign the RAW response body.
// Verification accepts hex or base64 encodings (the public docs do not pin the
// encoding — confirmed as a practice-mode checklist item in BUILD.md).
import crypto from 'node:crypto';
import { config } from './config.js';

export function secretKey() {
  if (!config.hmacSecret) return null;
  if (config.hmacSecretIsHex && /^[0-9a-fA-F]{64}$/.test(config.hmacSecret.trim())) {
    return Buffer.from(config.hmacSecret.trim(), 'hex');
  }
  return Buffer.from(config.hmacSecret, 'utf8');
}

export function signBody(rawBody, encoding = config.signatureEncoding) {
  const key = secretKey();
  if (!key) return '';
  return crypto.createHmac('sha256', key).update(rawBody).digest(encoding);
}

export function verifySignature(rawBody, headerValue) {
  const key = secretKey();
  if (!key) return { ok: false, reason: 'no-secret-configured' };
  if (!headerValue || typeof headerValue !== 'string') {
    return { ok: false, reason: 'missing-signature' };
  }
  const presented = headerValue.trim().replace(/^sha256=/i, '');
  for (const enc of ['hex', 'base64']) {
    const expected = crypto.createHmac('sha256', key).update(rawBody).digest(enc);
    const a = Buffer.from(expected);
    const b = Buffer.from(enc === 'hex' ? presented.toLowerCase() : presented);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { ok: true, encoding: enc };
    }
  }
  return { ok: false, reason: 'signature-mismatch' };
}
