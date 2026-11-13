// Persistent state: replay cache (proof_tx values we have APPROVED), the
// task-id idempotency cache (task_id -> the exact response we returned), and
// an append-only JSONL audit log of every task and decision.
//
// State lives in one JSON file rewritten atomically (tmp + rename) plus the
// audit log. Volume is tiny (8 tasks/round), so no database is warranted.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class Store {
  constructor(dir = config.dataDir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.statePath = path.join(dir, 'state.json');
    this.auditPath = path.join(dir, 'audit.jsonl');
    this.state = { approvedProofTx: {}, responses: {} };
    if (fs.existsSync(this.statePath)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
        if (loaded && typeof loaded === 'object') this.state = loaded;
      } catch {
        // Corrupt state must never silently reopen the replay gate:
        // start empty but scream about it in the audit log.
        this.audit({ event: 'state_load_failed', path: this.statePath });
      }
    }
  }

  isProofTxApproved(proofTx) {
    return Object.prototype.hasOwnProperty.call(this.state.approvedProofTx, proofTx);
  }

  markProofTxApproved(proofTx, taskId) {
    this.state.approvedProofTx[proofTx] = { task_id: taskId, at: new Date().toISOString() };
    this.persist();
  }

  getResponse(taskId) {
    return this.state.responses[taskId] || null;
  }

  saveResponse(taskId, response) {
    this.state.responses[taskId] = response;
    this.persist();
  }

  persist() {
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.statePath);
  }

  audit(entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(this.auditPath, line);
  }
}
