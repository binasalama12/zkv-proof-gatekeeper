import test from 'node:test';
import assert from 'node:assert/strict';

// hmac.js reads config at import time → set env first.
process.env.AGENT_GAMES_HMAC_SECRET = '0123456789abcdef'.repeat(4); // 64 hex chars
process.env.HMAC_SECRET_IS_HEX = '1';

const { signBody, verifySignature } = await import('../src/hmac.js');

test('hex signature roundtrip verifies', () => {
  const body = Buffer.from('{"hello":"world"}');
  const sig = signBody(body, 'hex');
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(verifySignature(body, sig).ok, true);
});

test('base64 signature verifies too (encoding not pinned by public docs)', () => {
  const body = Buffer.from('{"a":1}');
  const sig = signBody(body, 'base64');
  assert.equal(verifySignature(body, sig).ok, true);
});

test('tampered body fails verification', () => {
  const body = Buffer.from('{"decision":"APPROVE"}');
  const sig = signBody(body, 'hex');
  assert.equal(verifySignature(Buffer.from('{"decision":"REJECT"}'), sig).ok, false);
});

test('missing header fails', () => {
  assert.equal(verifySignature(Buffer.from('{}'), undefined).ok, false);
});

test('sha256= prefix tolerated', () => {
  const body = Buffer.from('{}');
  const sig = signBody(body, 'hex');
  assert.equal(verifySignature(body, `sha256=${sig}`).ok, true);
});
