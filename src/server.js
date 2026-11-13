// HTTP(S) entrypoint. POST any path = task endpoint (the registered URL is a
// single endpoint). GET /health = health check used at agent registration.
// TLS: set TLS_KEY_PATH/TLS_CERT_PATH to serve HTTPS directly; otherwise the
// process serves HTTP and must sit behind an HTTPS terminator/tunnel
// (see BUILD.md hosting note) — the platform requires a public HTTPS URL.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { config } from './config.js';
import { Store } from './store.js';
import { createProver } from './prover.js';
import { createSubmitter } from './submit.js';
import { createVerifier } from './verify.js';
import { makeHandler, signResponse } from './decide.js';

const store = new Store();
const handler = makeHandler({
  store,
  prover: createProver(),
  submitter: createSubmitter(),
  verifier: createVerifier(),
});

const MAX_BODY = 1024 * 1024;

async function onRequest(req, res) {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'proof-gatekeeper' }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'body too large' }));
      return;
    }
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks);
  try {
    const { status, body } = await handler.handle(rawBody, req.headers);
    const headers = { 'content-type': 'application/json' };
    if (status === 200) headers['x-agent-games-signature'] = signResponse(body);
    res.writeHead(status, headers);
    res.end(body);
  } catch (e) {
    // Last-resort fail-closed: a decision-shaped reject beats a timeout.
    store.audit({ event: 'handler_crash', error: String(e && e.stack || e) });
    const body = JSON.stringify({
      decision: 'REJECT', reason_code: config.fallbackRejectCode, proof_tx: '',
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-agent-games-signature': signResponse(body),
    });
    res.end(body);
  }
}

const server = config.tlsKeyPath && config.tlsCertPath
  ? https.createServer(
      { key: fs.readFileSync(config.tlsKeyPath), cert: fs.readFileSync(config.tlsCertPath) },
      onRequest,
    )
  : http.createServer(onRequest);

server.listen(config.port, config.host, () => {
  const scheme = server instanceof https.Server ? 'https' : 'http';
  console.log(`proof-gatekeeper listening on ${scheme}://${config.host}:${config.port}`);
  console.log(`prover=${config.proverMode} submitter=${config.submitterMode} verify=${config.verifyMode} hmac=${config.requireHmac ? 'required' : 'OFF'}`);
});
