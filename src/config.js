// Central configuration, all from environment. No secrets in code.
// See BUILD.md for the full variable list and what each one gates.

function bool(v, dflt) {
  if (v === undefined) return dflt;
  return v === '1' || v.toLowerCase() === 'true';
}

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  tlsKeyPath: process.env.TLS_KEY_PATH || '',
  tlsCertPath: process.env.TLS_CERT_PATH || '',

  dataDir: process.env.DATA_DIR || new URL('../data', import.meta.url).pathname,

  // HMAC (platform-issued, shown once at agent registration)
  hmacSecret: process.env.AGENT_GAMES_HMAC_SECRET || '',
  // secret may be given as hex (64 hex chars = 32 bytes) or as a raw string
  hmacSecretIsHex: bool(process.env.HMAC_SECRET_IS_HEX, true),
  requireHmac: bool(process.env.REQUIRE_HMAC, true),
  // 'hex' | 'base64' — how WE sign responses. Verification accepts both.
  signatureEncoding: process.env.SIGNATURE_ENCODING || 'hex',

  // Decision-proof (agent's own Groth16 proof of its decision)
  circuitsDir: process.env.CIRCUITS_DIR || new URL('../circuits', import.meta.url).pathname,
  gatekeeperWasm: process.env.GATEKEEPER_WASM || 'gatekeeper.wasm',
  gatekeeperZkey: process.env.GATEKEEPER_ZKEY || 'gatekeeper_final.zkey',
  // vk hash of the gatekeeper circuit on zkVerify mainnet (from /api/circuit-info)
  gatekeeperVkHash:
    process.env.GATEKEEPER_VK_HASH ||
    '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0',
  // 'snarkjs' = real proving with the event circuit; 'localtest' = local test
  // circuit (plumbing tests only); 'none' = no proof (preflight plumbing only)
  proverMode: process.env.PROVER_MODE || 'none',

  // Proof submission to zkVerify: 'kurier' | 'none'
  submitterMode: process.env.SUBMITTER_MODE || 'none',
  kurierApiUrl: process.env.KURIER_API_URL || 'https://api.kurier.xyz/api/v1',
  kurierApiKey: process.env.KURIER_API_KEY || '',
  // how long to wait for finalization before returning the best-known reference
  submitWaitMs: Number(process.env.SUBMIT_WAIT_MS || 40000),

  // On-chain confirmation of the task's proof (official checklist step 02):
  // 'kurier' = look the proof_tx up via Kurier; 'off' = skip (local tests only)
  verifyMode: process.env.VERIFY_MODE || 'off',

  // Reason code used when infrastructure fails and we must fail closed.
  // VK_SUBSTITUTION is the closest documented code to "this proof could not be
  // established as belonging to the registered condition". See BUILD.md.
  fallbackRejectCode: process.env.FALLBACK_REJECT_CODE || 'VK_SUBSTITUTION',

  // Hard internal budget: always respond well inside the 60 s platform deadline.
  responseBudgetMs: Number(process.env.RESPONSE_BUDGET_MS || 50000),
};
