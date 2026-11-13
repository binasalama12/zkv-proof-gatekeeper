# Proof Gatekeeper agent — ops quickstart

Fail-closed payment gatekeeper for zkVerify Agent Games, Track 1.
Design + full context: `../BUILD.md`.

## Run

```bash
npm install
npm test            # 43 tests: checks / validation / HMAC / full HTTP pipeline / event-circuit mapping
npm start           # node src/server.js
```

## Configuration (environment)

| Var | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | 8080 / 0.0.0.0 | listen address |
| `TLS_KEY_PATH` / `TLS_CERT_PATH` | — | serve HTTPS directly; else HTTP behind a tunnel/terminator |
| `DATA_DIR` | `./data` | state.json (replay + idempotency) and audit.jsonl |
| `AGENT_GAMES_HMAC_SECRET` | — | platform-issued secret from agent registration |
| `HMAC_SECRET_IS_HEX` | 1 | secret format (64-hex = 32-byte key) |
| `REQUIRE_HMAC` | 1 | reject unsigned requests with 401 |
| `SIGNATURE_ENCODING` | hex | how we sign responses (verification accepts hex + base64) |
| `PROVER_MODE` | none | `snarkjs` = event circuit · `localtest` = test circuit · `none` |
| `SUBMITTER_MODE` | none | `kurier` = submit decision proofs via Kurier |
| `VERIFY_MODE` | off | `kurier` = on-chain confirmation of task proofs via Kurier job-status |
| `KURIER_API_URL` | https://api.kurier.xyz/api/v1 | Kurier REST base |
| `KURIER_API_KEY` | — | mainnet Kurier key (request from Horizen Labs) |
| `SUBMIT_WAIT_MS` | 40000 | finalization poll budget |
| `FALLBACK_REJECT_CODE` | VK_SUBSTITUTION | reason code when infrastructure fails closed |
| `RESPONSE_BUDGET_MS` | 50000 | internal budget inside the 60 s platform deadline |

## Layout

- `src/server.js` — HTTP(S) entry, `/health`, body cap, signed responses
- `src/decide.js` — orchestration: HMAC → parse → validate → idempotency → ladder → proof
- `src/validate.js` — strict schema validation (BigInt amounts)
- `src/checks.js` — the check ladder (one rung per trap)
- `src/store.js` — replay cache, idempotency cache, audit log (atomic persistence)
- `src/prover.js` + `src/circuitInputs.js` — decision-proof generation (snarkjs)
- `src/submit.js` — Kurier proof submission; `src/verify.js` — on-chain confirmation
- `circuits/` — event artifacts (gatekeeper.wasm, gatekeeper_final.zkey, vk export)
- `test-circuit/` — local test circuit + its dev ceremony (plumbing tests only)
- `test/` — node:test suites with one fixture per documented trap type; `test/circuitInputs.test.js` pins the event-circuit mapping + end-to-end proving
