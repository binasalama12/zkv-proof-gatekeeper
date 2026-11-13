import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baseTask, freshTx } from './fixtures.js';

const SECRET_HEX = '0123456789abcdef'.repeat(4);
const PORT = 18777;
const base = `http://127.0.0.1:${PORT}`;
let proc;
let dataDir;

function sign(bodyStr) {
  return crypto.createHmac('sha256', Buffer.from(SECRET_HEX, 'hex'))
    .update(Buffer.from(bodyStr)).digest('hex');
}
function verifyResponseSig(bodyStr, sig) {
  const expected = crypto.createHmac('sha256', Buffer.from(SECRET_HEX, 'hex'))
    .update(Buffer.from(bodyStr)).digest('hex');
  return sig === expected;
}
async function post(task, { signed = true } = {}) {
  const bodyStr = typeof task === 'string' ? task : JSON.stringify(task);
  const headers = { 'content-type': 'application/json' };
  if (signed) headers['x-agent-games-signature'] = sign(bodyStr);
  const res = await fetch(`${base}/task`, { method: 'POST', headers, body: bodyStr });
  const text = await res.text();
  return { res, text, json: JSON.parse(text) };
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-agent-'));
  proc = spawn('node', ['src/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      AGENT_GAMES_HMAC_SECRET: SECRET_HEX,
      REQUIRE_HMAC: '1',
      PROVER_MODE: 'localtest',
      SUBMITTER_MODE: 'none',
      VERIFY_MODE: 'off',
    },
    stdio: 'pipe',
  });
  // wait for listen line
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server start timeout')), 15000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('listening')) { clearTimeout(to); resolve(); }
    });
    proc.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  });
});

test.after(() => {
  proc && proc.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('health endpoint', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

test('unsigned request → 401', async () => {
  const { res } = await post(baseTask(), { signed: false });
  assert.equal(res.status, 401);
});

test('signed VALID task → APPROVE, response signed, decision proof generated', async () => {
  const task = baseTask();
  const { res, text, json } = await post(task);
  assert.equal(res.status, 200);
  assert.equal(json.decision, 'APPROVE');
  assert.equal(json.reason_code, 'VALID_CONDITION');
  assert.equal(json.proof_tx, task.input.proof_tx); // submitter=none → echo fallback
  assert.ok(verifyResponseSig(text, res.headers.get('x-agent-games-signature')));
  // audit log proves the localtest prover really ran (proof_error must be null)
  const audit = fs.readFileSync(path.join(dataDir, 'audit.jsonl'), 'utf8');
  const line = audit.trim().split('\n').map((l) => JSON.parse(l))
    .find((e) => e.event === 'decision' && e.task_id === task.task_id);
  assert.ok(line, 'decision audited');
  assert.equal(line.proof_error, null);
});

test('same proof_tx in a new task → PROOF_REUSED, no proof submitted for it', async () => {
  const tx = freshTx();
  const first = await post(baseTask({}, { proof_tx: tx }));
  assert.equal(first.json.decision, 'APPROVE');
  const second = await post(baseTask({}, { proof_tx: tx }));
  assert.equal(second.json.decision, 'REJECT');
  assert.equal(second.json.reason_code, 'PROOF_REUSED');
});

test('idempotent redelivery: same task_id returns byte-identical body', async () => {
  const task = baseTask();
  const a = await post(task);
  const b = await post(task);
  assert.equal(a.text, b.text);
});

test('signed malformed body → REJECT MALFORMED (still 200, still signed)', async () => {
  const { res, text, json } = await post('{"type":"agent-games.proof-gatekeeper.v1","task_id":"x"}');
  assert.equal(res.status, 200);
  assert.equal(json.decision, 'REJECT');
  assert.equal(json.reason_code, 'MALFORMED');
  assert.ok(verifyResponseSig(text, res.headers.get('x-agent-games-signature')));
});

test('VK substitution over HTTP → REJECT VK_SUBSTITUTION', async () => {
  const { json } = await post(baseTask({}, { proof_vk: '0x' + 'bb'.repeat(32) }));
  assert.equal(json.decision, 'REJECT');
  assert.equal(json.reason_code, 'VK_SUBSTITUTION');
});
