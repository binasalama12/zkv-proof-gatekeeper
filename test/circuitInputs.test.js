// Gatekeeper (event circuit) witness mapping — unit + end-to-end tests.
// The mapping was recovered empirically from the shipped wasm (see
// src/circuitInputs.js); these tests pin it: exact input names, encodings,
// public-signal layout, and the circuit's decision-correctness enforcement.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import * as snarkjs from 'snarkjs';
import { validateTask } from '../src/validate.js';
import {
  buildGatekeeperInputs,
  assertGatekeeperPublicSignals,
  GATEKEEPER_PUBLIC_LAYOUT,
} from '../src/circuitInputs.js';
import { SnarkjsProver } from '../src/prover.js';
import { baseTask, VK, VK_OTHER, RECIPIENT } from './fixtures.js';

const FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);
const modP = (x) => ((x % FIELD) + FIELD) % FIELD;

function validated(overrides = {}, inputOverrides = {}) {
  const v = validateTask(baseTask(overrides, inputOverrides));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return v.task;
}

const circuitsDir = new URL('../circuits', import.meta.url).pathname;
const vk = JSON.parse(
  fs.readFileSync(path.join(circuitsDir, 'gatekeeper_vk.json'), 'utf8'),
);
function eventProver() {
  return new SnarkjsProver(
    path.join(circuitsDir, 'gatekeeper.wasm'),
    path.join(circuitsDir, 'gatekeeper_final.zkey'),
    buildGatekeeperInputs,
    'event-circuit',
    assertGatekeeperPublicSignals,
  );
}

test('mapping: exactly the 13 circuit input names', () => {
  const inputs = buildGatekeeperInputs(validated(), { decision: 'APPROVE', reason_code: 'VALID_CONDITION' });
  assert.deepEqual(Object.keys(inputs).sort(), [
    'amount', 'conditionRecipient', 'currentBlock', 'decision', 'expiryBlock',
    'maxTransfer', 'minimum', 'proofVkHash', 'publicBalance', 'recipient',
    'registeredVkHash', 'salt', 'taskId',
  ]);
});

test('mapping: encodings match the validated task', () => {
  const task = validated({ task_id: 'gk_test_abc123' });
  const inputs = buildGatekeeperInputs(task, { decision: 'REJECT', reason_code: 'VK_SUBSTITUTION' });
  assert.equal(inputs.registeredVkHash, (BigInt(VK) % FIELD).toString());
  assert.equal(inputs.proofVkHash, (BigInt(VK) % FIELD).toString());
  assert.equal(inputs.recipient, BigInt(RECIPIENT).toString());
  assert.equal(inputs.conditionRecipient, BigInt(RECIPIENT).toString());
  assert.equal(inputs.minimum, '1000');
  assert.equal(inputs.publicBalance, '1460');
  assert.equal(inputs.expiryBlock, '19842201');
  assert.equal(inputs.currentBlock, '19832000');
  assert.equal(inputs.amount, '500');
  assert.equal(inputs.maxTransfer, '1000');
  assert.equal(inputs.decision, '0');
  const expectedTaskId = modP(
    BigInt('0x' + crypto.createHash('sha256').update('gk_test_abc123').digest('hex')),
  ).toString();
  assert.equal(inputs.taskId, expectedTaskId);
});

test('mapping: salt is fresh, non-zero and in-field per proof', () => {
  const task = validated();
  const a = buildGatekeeperInputs(task, { decision: 'APPROVE', reason_code: 'VALID_CONDITION' });
  const b = buildGatekeeperInputs(task, { decision: 'APPROVE', reason_code: 'VALID_CONDITION' });
  assert.notEqual(a.salt, b.salt);
  assert.ok(BigInt(a.salt) > 0n && BigInt(a.salt) < FIELD);
});

test('mapping: bad decision / out-of-field amount / non-hex vk throw', () => {
  const task = validated();
  assert.throws(() => buildGatekeeperInputs(task, { decision: 'MAYBE', reason_code: 'MALFORMED' }), /bad decision/);
  assert.throws(
    () => buildGatekeeperInputs({ ...task, amount: FIELD }, { decision: 'APPROVE', reason_code: 'VALID_CONDITION' }),
    /out of field range/,
  );
  assert.throws(
    () => buildGatekeeperInputs({ ...task, proof_vk: 'not-hex' }, { decision: 'APPROVE', reason_code: 'VALID_CONDITION' }),
    /not hex/,
  );
  assert.throws(
    () => buildGatekeeperInputs({ ...task, task_id: '' }, { decision: 'APPROVE', reason_code: 'VALID_CONDITION' }),
    /task_id missing/,
  );
});

test('mapping: public-signal layout constant has 13 entries', () => {
  assert.equal(GATEKEEPER_PUBLIC_LAYOUT.length, 13);
  assert.equal(GATEKEEPER_PUBLIC_LAYOUT[0], 'binding');
  assert.equal(GATEKEEPER_PUBLIC_LAYOUT[12], 'taskId');
});

// --- end-to-end: real proving against the event circuit -------------------

test('event circuit: valid APPROVE proves and verifies; public signals echo inputs', async () => {
  const task = validated({ task_id: 'gk_e2e_valid' });
  const decisionInfo = { decision: 'APPROVE', reason_code: 'VALID_CONDITION' };
  // Direct prove with KNOWN inputs (fixed salt) so the binding commitment
  // Poseidon([salt, taskId]) can be checked explicitly by the exported checker.
  const inputs = buildGatekeeperInputs(task, decisionInfo);
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    path.join(circuitsDir, 'gatekeeper.wasm'),
    path.join(circuitsDir, 'gatekeeper_final.zkey'),
  );
  const proveMs = Date.now() - t0;
  await assertGatekeeperPublicSignals(publicSignals, inputs);
  assert.equal(await snarkjs.groth16.verify(vk, publicSignals, proof), true);
  // layout: [0] binding, [1..12] echoes in GATEKEEPER_PUBLIC_LAYOUT order.
  assert.equal(publicSignals.length, 13);
  assert.equal(publicSignals[1], (BigInt(VK) % FIELD).toString());
  assert.equal(publicSignals[2], (BigInt(VK) % FIELD).toString());
  assert.equal(publicSignals[3], '1000');
  assert.equal(publicSignals[4], '1460');
  assert.equal(publicSignals[5], '19842201');
  assert.equal(publicSignals[6], '19832000');
  assert.equal(publicSignals[7], BigInt(RECIPIENT).toString());
  assert.equal(publicSignals[8], BigInt(RECIPIENT).toString());
  assert.equal(publicSignals[9], '500');
  assert.equal(publicSignals[10], '1000');
  assert.equal(publicSignals[11], '1');
  assert.equal(publicSignals[12], inputs.taskId);
  assert.ok(proveMs < 20000, `proving took ${proveMs}ms`);
  // Integrated path: prover.prove runs the same self-check internally.
  const bundle = await eventProver().prove(task, decisionInfo);
  assert.equal(bundle.prover, 'event-circuit');
  assert.equal(await snarkjs.groth16.verify(vk, bundle.publicSignals, bundle.proof), true);
});

test('event circuit: APPROVE of a vk-mismatch trap cannot prove', async () => {
  const task = validated({}, { proof_vk: VK_OTHER });
  const prover = eventProver();
  await assert.rejects(
    prover.prove(task, { decision: 'APPROVE', reason_code: 'VALID_CONDITION' }),
  );
});

test('event circuit: correct REJECT of a vk-mismatch trap proves and verifies', async () => {
  const task = validated({ task_id: 'gk_e2e_trap' }, { proof_vk: VK_OTHER });
  const prover = eventProver();
  const bundle = await prover.prove(task, { decision: 'REJECT', reason_code: 'VK_SUBSTITUTION' });
  assert.equal(await snarkjs.groth16.verify(vk, bundle.publicSignals, bundle.proof), true);
  assert.equal(bundle.publicSignals[11], '0');
});

test('event circuit: REJECT of a fully-valid request cannot prove', async () => {
  const task = validated();
  const prover = eventProver();
  await assert.rejects(
    prover.prove(task, { decision: 'REJECT', reason_code: 'THRESHOLD_MISMATCH' }),
  );
});
