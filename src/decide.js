// Task orchestration: HMAC → parse → validate → idempotency → check ladder →
// decision proof → response. Every path responds; every doubt fails closed.
// The whole flow is budgeted to finish far inside the 60 s platform deadline.
import { config } from './config.js';
import { verifySignature, signBody } from './hmac.js';
import { validateTask } from './validate.js';
import { runChecks, REASON } from './checks.js';

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}-timeout`)), ms)),
  ]);
}

export function makeHandler({ store, prover, submitter, verifier }) {
  async function decide(task, rawTaskJson) {
    const started = Date.now();
    const verdict = await withTimeout(
      runChecks(task, {
        isProofTxApproved: (tx) => store.isProofTxApproved(tx),
        fallbackRejectCode: config.fallbackRejectCode,
        verifyOnChain: (t) => withTimeout(verifier.verifyOnChain(t), 15000, 'verify'),
      }).catch((e) => ({
        decision: 'REJECT',
        reason_code: config.fallbackRejectCode,
        checks: [{ name: 'ladder_error', pass: false, detail: String(e && e.message || e) }],
      })),
      config.responseBudgetMs,
      'ladder',
    );

    // Record the approval BEFORE proving/submitting: a duplicate delivery of
    // the same (or a replayed) task must never slip a second approval through.
    if (verdict.decision === 'APPROVE') store.markProofTxApproved(task.proof_tx, task.task_id);

    // Decision proof — skipped for PROOF_REUSED (the event rules state reused
    // tasks have no proof to submit) and for malformed tasks.
    let proofRef = null;
    let proofError = null;
    if (verdict.reason_code !== REASON.PROOF_REUSED) {
      try {
        const bundle = await withTimeout(
          prover.prove(task, verdict), 20000, 'prove',
        );
        if (bundle) {
          const submitted = await submitter.submit(bundle, config.gatekeeperVkHash);
          if (submitted) proofRef = submitted.reference;
        }
      } catch (e) {
        proofError = String(e && e.message || e);
      }
    }

    const response = {
      decision: verdict.decision,
      reason_code: verdict.reason_code,
      // Our decision-proof's network reference when we have one; otherwise
      // echo the task's own proof reference (decision still scores; only the
      // proof bonus / missing-proof penalty is at stake).
      proof_tx: proofRef || task.proof_tx_raw,
    };

    store.saveResponse(task.task_id, response);
    store.audit({
      event: 'decision',
      task_id: task.task_id,
      mode: task.mode,
      task: rawTaskJson,
      checks: verdict.checks,
      decision: verdict.decision,
      reason_code: verdict.reason_code,
      proof_reference: proofRef,
      proof_error: proofError,
      duration_ms: Date.now() - started,
    });
    return response;
  }

  /**
   * @returns {Promise<{status:number, body:string}>} body is the exact raw
   *          response body (sign it with signResponse before sending).
   */
  async function handle(rawBody, headers) {
    // 1 · Signature first, over the raw bytes, before any parsing.
    if (config.requireHmac) {
      const v = verifySignature(rawBody, headers['x-agent-games-signature']);
      if (!v.ok) {
        store.audit({ event: 'signature_rejected', reason: v.reason });
        return { status: 401, body: JSON.stringify({ error: 'invalid signature' }) };
      }
    }

    // 2 · Parse.
    let parsed;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      store.audit({ event: 'malformed', reason: 'invalid-json' });
      return {
        status: 200,
        body: JSON.stringify({ decision: 'REJECT', reason_code: REASON.MALFORMED, proof_tx: '' }),
      };
    }

    // 3 · Strict validation — malformed tasks fail closed.
    const v = validateTask(parsed);
    if (!v.ok) {
      const echo = parsed && parsed.input && typeof parsed.input.proof_tx === 'string'
        ? parsed.input.proof_tx : '';
      store.audit({ event: 'malformed', reason: v.errors.join(','), task_id: parsed && parsed.task_id });
      return {
        status: 200,
        body: JSON.stringify({ decision: 'REJECT', reason_code: REASON.MALFORMED, proof_tx: echo }),
      };
    }
    const task = v.task;

    // 4 · Idempotency: task_id is the idempotency key — a redelivery gets the
    //     byte-identical response we already committed to.
    const cached = store.getResponse(task.task_id);
    if (cached) {
      store.audit({ event: 'idempotent_replay', task_id: task.task_id });
      return { status: 200, body: JSON.stringify(cached) };
    }

    // 5 · Decide.
    const response = await decide(task, parsed);
    return { status: 200, body: JSON.stringify(response) };
  }

  return { handle };
}

export function signResponse(body) {
  return signBody(Buffer.from(body, 'utf8'));
}
