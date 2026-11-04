# Stello

Stello is a Soroban identity registry and compliant custom token prototype. The Circom circuit proves an age threshold, a zero leaf in a 248-level sparse sanctions tree, and an issuer's EdDSA-Poseidon signature. Proof generation runs client-side. Soroban's BN254 host functions perform the Groth16 check; deploy to a Stellar protocol/network that enables those functions (Protocol 25 or newer).

## Layout

- `circuits/`: circuit, sample input shape, and development setup script.
- `contracts/`: verifier, policy registry, and custom compliant token.
- `sdk/`: TypeScript local prover and Soroban transaction helpers.

## Build

Install Circom 2.x and OpenSSL, then run `npm install` in `sdk/`. From the repository root:

```sh
make circuits
make build
make test
```

The circuit setup script creates a **local development ceremony**. Never deploy its verification key. Run an independently reviewed, publicly verifiable multi-party ceremony and pin that ceremony's verification key in `stello_verifier` for production. The verifier initializer accepts the key and requires admin authorization; initialize it before the registry.

## Deployment and policy

Initialize the registry with an admin, verifier address, issuer key commitment, sanctions root, current year, and minimum age. Its `update_policy` entry point changes those expected public signals and requires admin authorization. The issuer commitment is Poseidon(issuer EdDSA public key X, Y). Circuit public inputs, in order, are current year, minimum age, sanctions root, issuer commitment, and wallet commitment. The sanctions tree uses zero as the empty leaf and derives its 248 path bits from the wallet commitment.

The wallet commitment is SHA-256 of the Soroban `ScVal(Address)` XDR encoding, truncated to 248 high-order bits and left-padded to 32 bytes. `hashSorobanAddress` in the SDK computes the prover input. The registry recomputes it from the authenticated caller's address. The registry pins all policy signals before invoking the verifier, preventing proofs against a prover-selected issuer or sanctions root.

The token contract maintains its own balances and allowances. It checks both parties' registry status on transfers and delegated transfers, and checks the recipient on mint. It is not a Stellar Asset Contract: a SAC cannot be made to intercept arbitrary transfer operations with a wrapper contract.

## Operational limitations

- Age and sanctions policy are only as current as the admin-updated public values. The registry does not infer a calendar year from ledger time or fetch sanctions data.
- Identity state and token ledger entries use Soroban TTL. Production operators need an authorized renewal strategy before TTL expiry.
- Compliance level is currently a single baseline level (`1`); the circuit does not prove multiple tiers.
- The development setup is single-party and must not be used for real funds or compliance decisions.
- The SDK returns unsigned transaction envelopes for wallet signing; callers must simulate/prepare and submit through their wallet/application flow.
