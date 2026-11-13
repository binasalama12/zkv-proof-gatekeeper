// Witness-input builders for decision proofs.
//
// LOCAL TEST circuit (test-circuit/decision.circom) — signals are ours:
//   public: decision (1=APPROVE, 0=REJECT), reasonCode (index below),
//           taskHashLo/Hi, proofTxLo/Hi (128-bit limbs of sha256 digests)
//   private: nonce (per-run binding)
//
// EVENT circuit (gatekeeper.wasm / gatekeeper_final.zkey) — Groth16/BN128
// with 13 public signals (verified from the exported verification key).
//
// INPUT MAPPING — recovered empirically 14 Nov 2026, NOT copied from any
// published source (the public starter prompt on /build and the /build page
// itself do NOT state the circuit's input names or public-signal order, and
// the dashboard copy could not be opened — X login is rate-limited):
//   1. The 13 input signal names were found by probing the shipped wasm's
//      getInputSignalSize() over candidate names (FNV-1a hash lookup): the
//      real inputs return size 1, unknown names return 0. The local test
//      circuit (known names) validated the method first.
//   2. The public-signal layout was read off a generated witness with
//      distinct values per field.
//   3. The binding output was identified as Poseidon([salt, taskId]) by
//      reproducing it exactly with circomlibjs.
//   4. Decision-correctness enforcement was verified with a 12-case matrix:
//      APPROVE of any trap (vk mismatch, balance<minimum, recipient
//      mismatch, expired, amount>max) FAILS witness generation (assert at
//      GatekeeperEvaluation line 102), and REJECT of a fully-valid request
//      fails too. The circuit is the referee: a wrong decision can never
//      produce a proof.
//
//   inputs (13, all size 1): registeredVkHash, proofVkHash, minimum,
//     publicBalance, expiryBlock, currentBlock, recipient,
//     conditionRecipient, amount, maxTransfer, taskId, decision, salt.
//     `salt` is the ONLY private input (fresh random per proof).
//   public signals (13, in order): [ Poseidon([salt, taskId]),
//     registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
//     currentBlock, recipient, conditionRecipient, amount, maxTransfer,
//     decision, taskId ]
//
// ENCODINGS:
//   - vk hashes (32-byte hex): BigInt(hex) mod p. The circuit only compares
//     the two field elements for equality; snarkjs normalizes inputs mod p
//     the same way, so this is the natural encoding — but the platform's own
//     reduction is NOT independently confirmed; practice mode is the check.
//   - recipient / conditionRecipient: 20-byte address as BigInt (fits field).
//   - minimum / publicBalance / amount / maxTransfer / blocks: BigInt, direct.
//   - taskId: sha256(task_id UTF-8) mod p. *** UNVERIFIED ASSUMPTION ***:
//     the public spec does not pin the taskId encoding. It mirrors this
//     repo's own local test circuit (sha256 task hash). If a practice task's
//     proof fails platform verification, try keccak256(task_id) mod p first.
//   - decision: '1' = APPROVE, '0' = REJECT (any other value throws).
//   - salt: fresh 128-bit random per proof, non-zero.
import crypto from 'node:crypto';
import { buildPoseidon } from 'circomlibjs';

export const REASON_INDEX = {
  VALID_CONDITION: 0,
  VK_SUBSTITUTION: 1,
  PROOF_REUSED: 2,
  THRESHOLD_MISMATCH: 3,
  EXPIRED_CONDITION: 4,
  RECIPIENT_MISMATCH: 5,
  AMOUNT_OVERFLOW: 6,
  MALFORMED: 7,
};

const BN128_FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);

// Public-signal layout of the event circuit (index → meaning). Index 0 is
// the Poseidon([salt, taskId]) binding commitment computed by the circuit.
export const GATEKEEPER_PUBLIC_LAYOUT = [
  'binding', // Poseidon([salt, taskId])
  'registeredVkHash',
  'proofVkHash',
  'minimum',
  'publicBalance',
  'expiryBlock',
  'currentBlock',
  'recipient',
  'conditionRecipient',
  'amount',
  'maxTransfer',
  'decision',
  'taskId',
];

function sha256BigInt(text) {
  const h = crypto.createHash('sha256').update(text).digest();
  return BigInt('0x' + h.toString('hex')) % BN128_FIELD;
}

function sha256Limbs(text) {
  const h = crypto.createHash('sha256').update(text).digest();
  const hi = BigInt('0x' + h.subarray(0, 16).toString('hex'));
  const lo = BigInt('0x' + h.subarray(16, 32).toString('hex'));
  return { lo: lo.toString(), hi: hi.toString() };
}

function toField(v, label) {
  const b = typeof v === 'bigint' ? v : BigInt(v);
  if (b < 0n || b >= BN128_FIELD) {
    throw new Error(`gatekeeper input out of field range: ${label}`);
  }
  return b;
}

function hexToField(v, label) {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]+$/.test(v.trim())) {
    throw new Error(`gatekeeper input not hex: ${label}`);
  }
  const b = BigInt(v.trim());
  if (b < 0n || b >= 1n << 256n) {
    throw new Error(`gatekeeper input out of 256-bit range: ${label}`);
  }
  return b % BN128_FIELD;
}

export function buildLocalTestInputs(task, decisionInfo) {
  const t = sha256Limbs(task.task_id);
  const p = sha256Limbs(task.proof_tx);
  return {
    decision: decisionInfo.decision === 'APPROVE' ? '1' : '0',
    reasonCode: String(REASON_INDEX[decisionInfo.reason_code] ?? 7),
    taskHashLo: t.lo,
    taskHashHi: t.hi,
    proofTxLo: p.lo,
    proofTxHi: p.hi,
    nonce: sha256BigInt(task.task_id + ':' + Date.now()).toString(),
  };
}

export function buildGatekeeperInputs(task, decisionInfo) {
  if (!task || typeof task !== 'object') {
    throw new Error('gatekeeper inputs: task missing');
  }
  if (decisionInfo.decision !== 'APPROVE' && decisionInfo.decision !== 'REJECT') {
    throw new Error(`gatekeeper inputs: bad decision ${decisionInfo.decision}`);
  }
  if (typeof task.task_id !== 'string' || task.task_id.length === 0) {
    throw new Error('gatekeeper inputs: task_id missing');
  }
  // Fresh 128-bit salt per proof (private binding; the circuit's public
  // binding output is Poseidon([salt, taskId])). Never zero.
  let salt = 0n;
  while (salt === 0n) salt = BigInt('0x' + crypto.randomBytes(16).toString('hex'));

  const inputs = {
    registeredVkHash: hexToField(task.registered_vk, 'registered_vk').toString(),
    proofVkHash: hexToField(task.proof_vk, 'proof_vk').toString(),
    minimum: toField(task.minimum, 'minimum').toString(),
    publicBalance: toField(task.public_balance, 'public_balance').toString(),
    expiryBlock: toField(task.expiry_block, 'expiry_block').toString(),
    currentBlock: toField(task.current_block, 'current_block').toString(),
    recipient: hexToField(task.recipient, 'recipient').toString(),
    conditionRecipient: hexToField(task.condition_recipient, 'condition_recipient').toString(),
    amount: toField(task.amount, 'amount').toString(),
    maxTransfer: toField(task.max_transfer, 'max_transfer').toString(),
    taskId: sha256BigInt(task.task_id).toString(),
    decision: decisionInfo.decision === 'APPROVE' ? '1' : '0',
    salt: salt.toString(),
  };
  return inputs;
}

let poseidonPromise = null;
function loadPoseidon() {
  if (!poseidonPromise) poseidonPromise = buildPoseidon();
  return poseidonPromise;
}

/**
 * Self-check for an event-circuit proof: recompute the binding commitment
 * and confirm every public signal echoes the inputs we supplied. Throws on
 * any mismatch — a proof that fails this must never be submitted.
 * `inputs` is the object returned by buildGatekeeperInputs (decimal strings).
 */
export async function assertGatekeeperPublicSignals(publicSignals, inputs) {
  if (!Array.isArray(publicSignals) || publicSignals.length !== 13) {
    throw new Error(
      `gatekeeper public signals: expected 13, got ${publicSignals?.length}`,
    );
  }
  const poseidon = await loadPoseidon();
  const binding = poseidon.F.toObject(
    poseidon([BigInt(inputs.salt), BigInt(inputs.taskId)]),
  );
  if (BigInt(publicSignals[0]) !== binding) {
    throw new Error('gatekeeper public signals: binding mismatch (Poseidon([salt, taskId]))');
  }
  const echo = [
    inputs.registeredVkHash,
    inputs.proofVkHash,
    inputs.minimum,
    inputs.publicBalance,
    inputs.expiryBlock,
    inputs.currentBlock,
    inputs.recipient,
    inputs.conditionRecipient,
    inputs.amount,
    inputs.maxTransfer,
    inputs.decision,
    inputs.taskId,
  ];
  for (let i = 0; i < echo.length; i++) {
    if (BigInt(publicSignals[i + 1]) !== BigInt(echo[i])) {
      throw new Error(
        `gatekeeper public signals: mismatch at index ${i + 1} (${GATEKEEPER_PUBLIC_LAYOUT[i + 1]})`,
      );
    }
  }
}
