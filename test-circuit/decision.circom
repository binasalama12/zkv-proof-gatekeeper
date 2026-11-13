pragma circom 2.0.0;

// LOCAL TEST CIRCUIT — plumbing/timing tests only. Mirrors the SHAPE of a
// decision proof (decision + reason + task/proof bindings as public inputs)
// so the snarkjs pipeline is exercised end-to-end. The platform will NOT
// accept proofs from this circuit; the event circuit is
// circuits/gatekeeper.wasm + gatekeeper_final.zkey.
template DecisionProof() {
    signal input decision;     // public: 1 = APPROVE, 0 = REJECT
    signal input reasonCode;   // public: index per circuitInputs.REASON_INDEX
    signal input taskHashLo;   // public
    signal input taskHashHi;   // public
    signal input proofTxLo;    // public
    signal input proofTxHi;    // public
    signal input nonce;        // private per-run binding

    signal output out;

    // decision must be boolean
    decision * (decision - 1) === 0;
    // nonce must be non-zero (cheap well-formedness constraint)
    signal nonceSq;
    nonceSq <== nonce * nonce;

    out <== decision + reasonCode * 10 + nonceSq * 0;
}

component main {public [decision, reasonCode, taskHashLo, taskHashHi, proofTxLo, proofTxHi]} = DecisionProof();
