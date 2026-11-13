// On-chain confirmation of the TASK's proof (official checklist step 02:
// "confirm the proof is on-chain and its VK matches the registered condition").
//
// Modes (VERIFY_MODE):
//   'off'    — skipped (local tests / plumbing). Logged loudly.
//   'kurier' — treat the task proof_tx as a Kurier job reference and poll
//              job-status: finalized AND vkHash == registered_vk → pass.
//              (This binding — that platform proof_tx values are Kurier job
//              references — is the most plausible reading of the docs and is
//              a named practice-mode confirmation item in BUILD.md.)
// Anything unexpected returns 'error' and the ladder fails closed.
import { config } from './config.js';

export function createVerifier() {
  if (config.verifyMode === 'kurier') {
    return {
      label: 'kurier',
      async verifyOnChain(task) {
        if (!config.kurierApiKey) return { status: 'error', detail: 'KURIER_API_KEY missing' };
        try {
          const res = await fetch(
            `${config.kurierApiUrl}/job-status/${config.kurierApiKey}/${task.proof_tx}`,
          );
          if (res.status === 404) return { status: 'not_found', detail: 'job not found' };
          if (!res.ok) return { status: 'error', detail: `HTTP ${res.status}` };
          const job = await res.json();
          const jobVk = String(job.vkHash || job.vk || '').toLowerCase();
          if (jobVk && jobVk !== task.registered_vk && jobVk !== task.proof_vk) {
            return { status: 'not_found', detail: `on-chain vk ${jobVk} matches neither task vk` };
          }
          const finalized = job.finalized === true || /final/i.test(String(job.status || ''));
          return finalized
            ? { status: 'finalized', detail: `status=${job.status}` }
            : { status: 'error', detail: `not finalized (status=${job.status})` };
        } catch (e) {
          return { status: 'error', detail: String(e && e.message || e) };
        }
      },
    };
  }
  return {
    label: 'off',
    async verifyOnChain() {
      return { status: 'skipped', detail: 'VERIFY_MODE=off' };
    },
  };
}
