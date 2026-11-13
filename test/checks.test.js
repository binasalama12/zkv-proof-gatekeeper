import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTask } from '../src/validate.js';
import { runChecks, REASON } from '../src/checks.js';
import { baseTask, VK_OTHER, RECIPIENT_OTHER, freshTx } from './fixtures.js';

const skipped = async () => ({ status: 'skipped' });
function ctxFor(store, verifyOnChain = skipped) {
  return {
    isProofTxApproved: (tx) => store.has(tx),
    fallbackRejectCode: 'VK_SUBSTITUTION',
    verifyOnChain,
  };
}
function makeStore() {
  const s = new Set();
  return { has: (tx) => s.has(tx), add: (tx) => s.add(tx) };
}
async function decide(taskJson, store, verifyOnChain) {
  const v = validateTask(taskJson);
  assert.equal(v.ok, true, `fixture must validate: ${JSON.stringify(v.errors)}`);
  return runChecks(v.task, ctxFor(store, verifyOnChain));
}

test('VALID_CONDITION → APPROVE', async () => {
  const r = await decide(baseTask(), makeStore());
  assert.equal(r.decision, 'APPROVE');
  assert.equal(r.reason_code, REASON.VALID);
  assert.ok(r.checks.every((c) => c.pass));
});

test('VK_SUBSTITUTION → REJECT (proof valid, wrong key)', async () => {
  const r = await decide(baseTask({}, { proof_vk: VK_OTHER }), makeStore());
  assert.equal(r.decision, 'REJECT');
  assert.equal(r.reason_code, REASON.VK_SUBSTITUTION);
});

test('THRESHOLD_MISMATCH → REJECT (balance below minimum)', async () => {
  const r = await decide(baseTask({}, { public_balance: '999' }), makeStore());
  assert.equal(r.decision, 'REJECT');
  assert.equal(r.reason_code, REASON.THRESHOLD_MISMATCH);
});

test('threshold boundary: balance == minimum approves', async () => {
  const r = await decide(baseTask({}, { public_balance: '1000' }), makeStore());
  assert.equal(r.decision, 'APPROVE');
});

test('RECIPIENT_MISMATCH → REJECT', async () => {
  const r = await decide(baseTask({}, { recipient: RECIPIENT_OTHER }), makeStore());
  assert.equal(r.decision, 'REJECT');
  assert.equal(r.reason_code, REASON.RECIPIENT_MISMATCH);
});

test('EXPIRED_CONDITION → REJECT (current block past expiry)', async () => {
  const r = await decide(baseTask({}, { current_block: 19842202 }), makeStore());
  assert.equal(r.decision, 'REJECT');
  assert.equal(r.reason_code, REASON.EXPIRED_CONDITION);
});

test('expiry boundary: current == expiry approves', async () => {
  const r = await decide(baseTask({}, { current_block: 19842201 }), makeStore());
  assert.equal(r.decision, 'APPROVE');
});

test('AMOUNT_OVERFLOW → REJECT (amount above single-transfer cap)', async () => {
  const r = await decide(baseTask({}, { amount: '1001' }), makeStore());
  assert.equal(r.decision, 'REJECT');
  assert.equal(r.reason_code, REASON.AMOUNT_OVERFLOW);
});

test('amount boundary: amount == max_transfer approves', async () => {
  const r = await decide(baseTask({}, { amount: '1000' }), makeStore());
  assert.equal(r.decision, 'APPROVE');
});

test('PROOF_REUSED → REJECT (same proof_tx approved before)', async () => {
  const store = makeStore();
  const tx = freshTx();
  const first = await decide(baseTask({}, { proof_tx: tx }), store);
  assert.equal(first.decision, 'APPROVE');
  store.add(tx); // what decide.js persists after an APPROVE
  const second = await decide(baseTask({}, { proof_tx: tx }), store);
  assert.equal(second.decision, 'REJECT');
  assert.equal(second.reason_code, REASON.PROOF_REUSED);
});

test('on-chain not_found → REJECT VK_SUBSTITUTION', async () => {
  const r = await decide(baseTask(), makeStore(), async () => ({ status: 'not_found' }));
  assert.equal(r.decision, 'REJECT');
  assert.equal(r.reason_code, REASON.VK_SUBSTITUTION);
});

test('on-chain error → fail closed REJECT with fallback code', async () => {
  const r = await decide(baseTask(), makeStore(), async () => ({ status: 'error', detail: 'boom' }));
  assert.equal(r.decision, 'REJECT');
  assert.equal(r.reason_code, 'VK_SUBSTITUTION');
});

test('huge decimal amounts compare exactly (BigInt, no float drift)', async () => {
  const r = await decide(
    baseTask({}, {
      minimum: '99999999999999999999999999',
      public_balance: '99999999999999999999999998',
    }),
    makeStore(),
  );
  assert.equal(r.decision, 'REJECT');
  assert.equal(r.reason_code, REASON.THRESHOLD_MISMATCH);
});
