#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
OUT="build"
mkdir -p "$OUT"
command -v circom >/dev/null || { echo 'circom 2.x is required' >&2; exit 1; }
command -v npx >/dev/null || { echo 'Node.js/npm is required' >&2; exit 1; }
circom identity_verifier.circom --r1cs --wasm --sym -l ../sdk/node_modules -o "$OUT"
npx --yes --package snarkjs snarkjs powersoftau new bn128 20 "$OUT/pot20_0000.ptau" -v
npx --yes --package snarkjs snarkjs powersoftau contribute "$OUT/pot20_0000.ptau" "$OUT/pot20_0001.ptau" --name="local development" -e="$(openssl rand -hex 32)"
npx --yes --package snarkjs snarkjs powersoftau prepare phase2 "$OUT/pot20_0001.ptau" "$OUT/pot20_final.ptau" -v
npx --yes --package snarkjs snarkjs groth16 setup "$OUT/identity_verifier.r1cs" "$OUT/pot20_final.ptau" "$OUT/identity_verifier_0000.zkey"
npx --yes --package snarkjs snarkjs zkey contribute "$OUT/identity_verifier_0000.zkey" "$OUT/identity_verifier_final.zkey" --name="local development" -e="$(openssl rand -hex 32)"
npx --yes --package snarkjs snarkjs zkey export verificationkey "$OUT/identity_verifier_final.zkey" "$OUT/verification_key.json"
echo "Development artifacts in $OUT. This locally generated ceremony is not suitable for production."
