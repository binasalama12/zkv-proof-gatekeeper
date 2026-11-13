// The check ladder. Fail-closed: the FIRST failed check decides, every check
// is recorded for the audit trail. Order mirrors the official build checklist
// (parse → VK/on-chain → balance → recipient → seen-set → expiry) with the
// amount cap checked alongside the other numeric conditions.
//
// "A proof can verify perfectly and still authorize the wrong action" —
// proof validity (on-chain confirmation) and request acceptability (the
// condition fields) are separate rungs and both must pass.

export const REASON = {
  VALID: 'VALID_CONDITION',
  VK_SUBSTITUTION: 'VK_SUBSTITUTION',
  THRESHOLD_MISMATCH: 'THRESHOLD_MISMATCH',
  RECIPIENT_MISMATCH: 'RECIPIENT_MISMATCH',
  PROOF_REUSED: 'PROOF_REUSED',
  EXPIRED_CONDITION: 'EXPIRED_CONDITION',
  AMOUNT_OVERFLOW: 'AMOUNT_OVERFLOW',
  MALFORMED: 'MALFORMED',
};

/**
 * @param {object} task  validated task from validate.js
 * @param {object} ctx
 * @param {(proofTx:string)=>boolean} ctx.isProofTxApproved  replay cache lookup
 * @param {(task)=>Promise<{status:string, detail?:string}>} ctx.verifyOnChain
 *        returns 'finalized' | 'not_found' | 'error' | 'skipped'
 */
export async function runChecks(task, ctx) {
  const checks = [];
  const fail = (name, reason_code, detail) => {
    checks.push({ name, pass: false, detail });
    return { decision: 'REJECT', reason_code, checks };
  };
  const pass = (name, detail) => checks.push({ name, pass: true, detail });

  // 1 · Verification key: the proof's VK must be the registered condition VK.
  if (task.proof_vk !== task.registered_vk) {
    return fail('vk_match', REASON.VK_SUBSTITUTION,
      `proof_vk ${task.proof_vk} != registered_vk ${task.registered_vk}`);
  }
  pass('vk_match', 'proof_vk == registered_vk');

  // 2 · On-chain confirmation: the proof reference must exist on zkVerify and
  //     be finalized under the registered VK (official checklist step 02).
  const oc = await ctx.verifyOnChain(task);
  if (oc.status === 'not_found') {
    return fail('onchain_finalized', REASON.VK_SUBSTITUTION,
      `proof_tx not found/finalized on-chain: ${oc.detail || ''}`);
  }
  if (oc.status === 'error') {
    // Fail closed on infrastructure failure — never approve the unverifiable.
    return fail('onchain_finalized', ctx.fallbackRejectCode,
      `on-chain verification unavailable: ${oc.detail || ''}`);
  }
  pass('onchain_finalized', oc.status === 'skipped' ? 'skipped by configuration' : 'finalized on-chain');

  // 3 · Threshold: disclosed public balance must meet the condition minimum.
  if (task.public_balance < task.minimum) {
    return fail('threshold', REASON.THRESHOLD_MISMATCH,
      `public_balance ${task.public_balance} < minimum ${task.minimum}`);
  }
  pass('threshold', `public_balance ${task.public_balance} >= minimum ${task.minimum}`);

  // 4 · Recipient: the proof's recipient must be the condition's recipient.
  if (task.recipient !== task.condition_recipient) {
    return fail('recipient', REASON.RECIPIENT_MISMATCH,
      `recipient ${task.recipient} != condition_recipient ${task.condition_recipient}`);
  }
  pass('recipient', 'recipient == condition_recipient');

  // 5 · Replay: a proof reference already ACCEPTED once never re-enters.
  if (ctx.isProofTxApproved(task.proof_tx)) {
    return fail('replay', REASON.PROOF_REUSED,
      `proof_tx ${task.proof_tx} already approved in a previous task`);
  }
  pass('replay', 'proof_tx not previously approved');

  // 6 · Expiry: the condition window must still be open at the current block.
  if (task.current_block > task.expiry_block) {
    return fail('expiry', REASON.EXPIRED_CONDITION,
      `current_block ${task.current_block} > expiry_block ${task.expiry_block}`);
  }
  pass('expiry', `current_block ${task.current_block} <= expiry_block ${task.expiry_block}`);

  // 7 · Amount cap: the requested amount must not exceed the single-transfer cap.
  if (task.amount > task.max_transfer) {
    return fail('amount_cap', REASON.AMOUNT_OVERFLOW,
      `amount ${task.amount} > max_transfer ${task.max_transfer}`);
  }
  pass('amount_cap', `amount ${task.amount} <= max_transfer ${task.max_transfer}`);

  return { decision: 'APPROVE', reason_code: REASON.VALID, checks };
}
