// Synthetic fixtures: one task per documented trap type, built from the
// official sample payload on the Proof Gatekeeper event page.
export const VK = '0x' + 'aa'.repeat(32);
export const VK_OTHER = '0x' + 'bb'.repeat(32);
export const RECIPIENT = '0x' + '11'.repeat(20);
export const RECIPIENT_OTHER = '0x' + '22'.repeat(20);
let txCounter = 0;
export function freshTx() {
  txCounter += 1;
  return '0x' + txCounter.toString(16).padStart(64, '0');
}

export function baseTask(overrides = {}, inputOverrides = {}) {
  return {
    type: 'agent-games.proof-gatekeeper.v1',
    task_id: overrides.task_id || `gk_test_${Math.random().toString(36).slice(2, 9)}`,
    mode: 'practice',
    issued_at: '2026-11-14T10:00:00.000Z',
    deadline_at: '2026-11-14T10:01:00.000Z',
    input: {
      registered_vk: VK,
      proof_vk: VK,
      minimum: '1000',
      public_balance: '1460',
      expiry_block: 19842201,
      current_block: 19832000,
      recipient: RECIPIENT,
      condition_recipient: RECIPIENT,
      amount: '500',
      max_transfer: '1000',
      proof_tx: freshTx(),
      ...inputOverrides,
    },
    ...overrides,
  };
}

export function validateOk(taskJson) {
  // local require-free dynamic import shim for tests: validate.js is imported
  // by the test files themselves; this helper only shapes fixtures.
  return taskJson;
}
