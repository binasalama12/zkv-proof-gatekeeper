// Proof submission to zkVerify — turns a locally generated Groth16 proof
// into the network reference (proof_tx) the platform independently confirms.
//
// Kurier request shape follows docs.zkverify.io Quickstart (Path A):
//   POST {KURIER_API_URL}/submit-proof/{API_KEY}
//   { proofType: 'groth16', vkRegistered: true,
//     proofOptions: { library: 'snarkjs', curve: 'bn254' },
//     proofData: { proof, publicSignals, vk: <gatekeeper vkHash> } }
// Job status polling endpoint/field names are defensive-parsed; the exact
// status vocabulary must be confirmed on the first practice submission
// (see BUILD.md checklist).
import { config } from './config.js';

export class KurierSubmitter {
  constructor() {
    this.label = 'kurier';
  }

  async submit(proofBundle, vkHash) {
    if (!config.kurierApiKey) throw new Error('KURIER_API_KEY not configured');
    const res = await fetch(`${config.kurierApiUrl}/submit-proof/${config.kurierApiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        proofType: 'groth16',
        vkRegistered: true,
        proofOptions: { library: 'snarkjs', curve: 'bn254' },
        proofData: {
          proof: proofBundle.proof,
          publicSignals: proofBundle.publicSignals,
          vk: vkHash,
        },
      }),
    });
    if (!res.ok) throw new Error(`kurier submit-proof HTTP ${res.status}`);
    const job = await res.json();
    const jobId = job.jobId || job.id || job.job_id;
    if (!jobId) throw new Error('kurier submit-proof: no job id in response');

    // Poll until finalized or the wait budget runs out; return the best
    // reference we have. The reliability bonus is computed at round close,
    // so a reference that finalizes shortly after our response still counts.
    const deadline = Date.now() + config.submitWaitMs;
    let reference = job.txHash || job.tx_hash || jobId;
    let status = job.status || 'Submitted';
    while (Date.now() < deadline && !/final/i.test(String(status))) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const sres = await fetch(
          `${config.kurierApiUrl}/job-status/${config.kurierApiKey}/${jobId}`,
        );
        if (!sres.ok) break;
        const sjob = await sres.json();
        status = sjob.status || sjob.jobStatus || status;
        reference = sjob.txHash || sjob.tx_hash || sjob.proofTx || reference;
        if (sjob.finalized === true) status = 'Finalized';
      } catch {
        break;
      }
    }
    return { reference: String(reference), jobId: String(jobId), status: String(status) };
  }
}

export function createSubmitter() {
  if (config.submitterMode === 'kurier') return new KurierSubmitter();
  return {
    label: 'none',
    async submit() { return null; },
  };
}
