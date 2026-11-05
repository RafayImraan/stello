# Stello

Stello is a Soroban identity registry and compliance-gated custom token. The Circom circuit proves an age threshold, a zero leaf in a 248-level sparse sanctions tree, and an issuer's EdDSA-Poseidon signature. Proof generation runs locally with the SDK. Soroban's BN254 host functions perform the Groth16 check; deploy to a Stellar network that enables those functions (Protocol 25 or newer).

## Layout

- `circuits/`: circuit, sample input shape, and development setup script.
- `contracts/`: verifier, policy registry, and custom compliant token.
- `sdk/`: TypeScript local prover and Soroban transaction helpers.
- `web/`: static, responsive hackathon demo UI for Vercel.

## Hosted demo UI

The `web/` folder is the static front end and `vercel.json` sets it as Vercel's output directory. Import this repository in Vercel with the project root set to the repository root; no build command or environment variables are required. The current UI connects a Stellar Testnet wallet through Varial (formerly Freighter). Identity proof submission requires the circuit artifacts and deployed contract addresses.

## Build

Install Node.js, Rust with the `wasm32v1-none` target, and Stellar CLI 25.2.0 or newer. Run `npm install` in `sdk/` to install the pinned Circom compiler and SDK dependencies. From the repository root:

```sh
make circuits
make build
make test
make demo-proof
```

`make demo-proof` creates a temporary issuer credential, empty sanctions tree, and wallet commitment, generates a Groth16 proof locally, then verifies it with snarkjs. Its wallet commitment is random unless you run `node circuits/generate_demo_input.mjs <year> <min-age> <stellar-address>`. The generated issuer key and empty sanctions tree are demonstration-only. `circuits/build/demo-policy.json` contains the matching public policy values in decimal and hex. `circuits/inputs.json.example` documents the witness shape; use the generator for a satisfiable development witness.

The circuit setup script creates a **local development ceremony**. Never deploy its verification key. Run an independently reviewed, publicly verifiable multi-party ceremony and pin that ceremony's verification key in `stello_verifier` for production. The verifier initializer accepts the key and requires admin authorization; initialize it before the registry.

## Deployment and policy

Initialize the registry with an admin, verifier address, issuer key commitment, sanctions root, current year, and minimum age. Its `update_policy` entry point changes those expected public signals and requires admin authorization. The issuer commitment is Poseidon(issuer EdDSA public key X, Y). Circuit public inputs, in order, are current year, minimum age, sanctions root, issuer commitment, and wallet commitment. The issuer signature binds the wallet commitment, birth year, private-secret commitment, and current year, so year rotation invalidates old credentials. The sanctions tree uses zero as the empty leaf and derives its 248 path bits from the wallet commitment.

The wallet commitment is SHA-256 of the Soroban `ScVal(Address)` XDR encoding, truncated to 248 high-order bits and left-padded to 32 bytes. `hashSorobanAddress` in the SDK computes the prover input. The registry recomputes it from the authenticated caller's address. The registry pins all policy signals before invoking the verifier, preventing proofs against a prover-selected issuer or sanctions root.

The token contract maintains its own balances and allowances. It checks both parties' registry status on transfers and delegated transfers, and checks the recipient on mint. It is not a Stellar Asset Contract: a SAC cannot be made to intercept arbitrary transfer operations with a wrapper contract.

## Testnet deployment

This flow publishes contracts to **Testnet only**. It uses the local single-party circuit setup; the resulting verifier is a development demonstration and must not be used for real compliance decisions or funds.

1. Install Rust with the `wasm32v1-none` target, Node.js, Git Bash, and Stellar CLI 25.2.0 or newer. From the repository root run `npm.cmd install --prefix sdk`, then `bash circuits/build_circuits.sh` and `stellar contract build --manifest-path contracts/stello_verifier/Cargo.toml`, repeating the build command for `stello_registry` and `stello_token_wrapper`.
2. Generate a funded testnet deployer with `stellar keys generate stello-admin --network testnet --fund`. Deploy each built `.wasm` using `stellar contract deploy --wasm <path> --source-account stello-admin --network testnet`. Deploy verifier, registry, and wrapper in that order; record each returned `C...` contract ID. The CLI distinguishes uploaded Wasm from an instantiated contract, so use `contract deploy` for these instances.
3. Prepare the policy parameters from the same issuer key and sanctions tree used by the credential issuer: `STELLO_ISSUER_COMMITMENT` and `STELLO_SANCTIONS_ROOT` are 32-byte hex values without a prefix. Set the admin secret in `STELLO_ADMIN_SECRET` and the three IDs in `STELLO_VERIFIER_ID`, `STELLO_REGISTRY_ID`, and `STELLO_WRAPPER_ID`. Never commit or paste the secret into source control.
4. From `sdk/`, run `npm.cmd run build`, then set `STELLO_ISSUER_COMMITMENT`, `STELLO_SANCTIONS_ROOT`, and optionally `STELLO_CURRENT_YEAR`, `STELLO_MIN_AGE`, and `STELLO_REQUIRED_LEVEL`, then run `npm.cmd run initialize:testnet`. The SDK converts the generated snarkjs verification key to Soroban XDR values and initializes verifier, registry, and wrapper in order. Each transaction is simulated, signed locally, submitted, and polled for final status.

For production, replace the local setup with an independently reviewed, publicly verifiable multi-party ceremony, verify the generated key and circuit artifacts, and complete an external security review before deployment.

## Operational limitations

- Age and sanctions policy are only as current as the admin-updated public values. The registry does not infer a calendar year from ledger time or fetch sanctions data.
- Updating the issuer, sanctions root, year, or minimum age increments the policy version and invalidates existing identity registrations; users must register again against the new policy.
- Identity validity is capped at 180 days. Contract instances and persistent records refresh their TTL on use; users who remain inactive beyond the network's maximum Soroban TTL need an archival restoration/renewal flow before accessing state.
- Compliance level is currently a single baseline level (`1`); the circuit does not prove multiple tiers.
- The development setup is single-party and must not be used for real funds or compliance decisions.
- The SDK builds unsigned transaction envelopes; `submit()` prepares them, obtains the signature through a caller-supplied wallet signer, submits them, and waits for ledger confirmation.
