// Strict payload validation for agent-games.proof-gatekeeper.v1 tasks.
// Anything that does not match the documented schema exactly is MALFORMED and
// fails closed. Amounts are compared as BigInt — never as floats.

const HEX_RE = /^0x[0-9a-fA-F]+$/;
const DEC_RE = /^(0|[1-9][0-9]*)$/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseDecimal(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && DEC_RE.test(v)) return BigInt(v);
  return null;
}

function parseBlock(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && DEC_RE.test(v) && v.length <= 15) return Number(v);
  return null;
}

export function normalizeHex(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * Validate a parsed JSON body.
 * Returns { ok: true, task } or { ok: false, errors: [...] }.
 * task fields: string amounts are converted to BigInt; blocks to Number.
 */
export function validateTask(body) {
  const errors = [];
  if (!isPlainObject(body)) return { ok: false, errors: ['body-not-object'] };

  if (body.type !== 'agent-games.proof-gatekeeper.v1') errors.push('type-mismatch');
  if (typeof body.task_id !== 'string' || body.task_id.length === 0 || body.task_id.length > 200) {
    errors.push('task_id-invalid');
  }
  if (body.mode !== undefined && !['competition', 'practice', 'preflight'].includes(body.mode)) {
    errors.push('mode-invalid');
  }
  if (body.issued_at !== undefined && typeof body.issued_at !== 'string') errors.push('issued_at-invalid');
  if (body.deadline_at !== undefined && typeof body.deadline_at !== 'string') errors.push('deadline_at-invalid');

  const input = body.input;
  if (!isPlainObject(input)) {
    errors.push('input-missing');
    return { ok: false, errors };
  }

  for (const f of ['registered_vk', 'proof_vk', 'recipient', 'condition_recipient', 'proof_tx']) {
    if (typeof input[f] !== 'string' || !HEX_RE.test(input[f].trim())) errors.push(`${f}-invalid`);
  }
  const minimum = parseDecimal(input.minimum);
  const publicBalance = parseDecimal(input.public_balance);
  const amount = parseDecimal(input.amount);
  const maxTransfer = parseDecimal(input.max_transfer);
  if (minimum === null) errors.push('minimum-invalid');
  if (publicBalance === null) errors.push('public_balance-invalid');
  if (amount === null) errors.push('amount-invalid');
  if (maxTransfer === null) errors.push('max_transfer-invalid');
  const expiryBlock = parseBlock(input.expiry_block);
  const currentBlock = parseBlock(input.current_block);
  if (expiryBlock === null) errors.push('expiry_block-invalid');
  if (currentBlock === null) errors.push('current_block-invalid');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    task: {
      task_id: body.task_id,
      mode: body.mode || 'competition',
      issued_at: body.issued_at || null,
      deadline_at: body.deadline_at || null,
      registered_vk: normalizeHex(input.registered_vk),
      proof_vk: normalizeHex(input.proof_vk),
      minimum,
      public_balance: publicBalance,
      expiry_block: expiryBlock,
      current_block: currentBlock,
      recipient: normalizeHex(input.recipient),
      condition_recipient: normalizeHex(input.condition_recipient),
      amount,
      max_transfer: maxTransfer,
      proof_tx: normalizeHex(input.proof_tx),
      proof_tx_raw: input.proof_tx,
    },
  };
}
