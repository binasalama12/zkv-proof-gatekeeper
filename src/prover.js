// Decision-proof generation (the agent's OWN Groth16 proof of its decision).
//
// Clean interface:
//   prover.prove(task, decisionInfo) -> { proof, publicSignals } | null
//
// Modes (PROVER_MODE):
//   'snarkjs'   — real proving with the EVENT circuit (gatekeeper.wasm +
//                 gatekeeper_final.zkey). The witness-input mapping was
//                 recovered empirically from the shipped wasm on 14 Nov 2026
//                 (see circuitInputs.js) and verified end-to-end; the one
//                 remaining assumption is the taskId encoding (sha256 mod p),
//                 which practice mode must confirm.
//   'localtest' — real snarkjs proving against the LOCAL test circuit in
//                 test-circuit/ (plumbing + timing tests only; the platform
//                 will not accept these proofs).
//   'none'      — no proof (preflight plumbing only; costs −2 per provable
//                 task in scored rounds).
import path from 'node:path';
import { config } from './config.js';
import {
  buildLocalTestInputs,
  buildGatekeeperInputs,
  assertGatekeeperPublicSignals,
} from './circuitInputs.js';

let snarkjsPromise = null;
function loadSnarkjs() {
  if (!snarkjsPromise) snarkjsPromise = import('snarkjs');
  return snarkjsPromise;
}

export class SnarkjsProver {
  constructor(wasmPath, zkeyPath, inputBuilder, label, verifyPublicSignals) {
    this.wasmPath = wasmPath;
    this.zkeyPath = zkeyPath;
    this.inputBuilder = inputBuilder;
    this.label = label;
    this.verifyPublicSignals = verifyPublicSignals || null;
  }

  async prove(task, decisionInfo) {
    const inputs = this.inputBuilder(task, decisionInfo);
    const snarkjs = await loadSnarkjs();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs, this.wasmPath, this.zkeyPath,
    );
    // Fail closed: a proof whose public signals don't echo our inputs (or
    // whose binding commitment is wrong) must never be submitted.
    if (this.verifyPublicSignals) {
      await this.verifyPublicSignals(publicSignals, inputs);
    }
    return { proof, publicSignals, prover: this.label };
  }
}

export function createProver() {
  if (config.proverMode === 'snarkjs') {
    return new SnarkjsProver(
      path.join(config.circuitsDir, config.gatekeeperWasm),
      path.join(config.circuitsDir, config.gatekeeperZkey),
      buildGatekeeperInputs,
      'event-circuit',
      assertGatekeeperPublicSignals,
    );
  }
  if (config.proverMode === 'localtest') {
    const base = new URL('../test-circuit/build', import.meta.url).pathname;
    return new SnarkjsProver(
      path.join(base, 'decision_js', 'decision.wasm'),
      path.join(base, 'decision_final.zkey'),
      buildLocalTestInputs,
      'local-test-circuit',
    );
  }
  return { async prove() { return null; }, label: 'none' };
}
