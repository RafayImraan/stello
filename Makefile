.PHONY: circuits build test demo-input demo-proof

circuits:
	node circuits/build_circuits.mjs

build:
	stellar contract build --manifest-path contracts/stello_verifier/Cargo.toml
	stellar contract build --manifest-path contracts/stello_registry/Cargo.toml
	stellar contract build --manifest-path contracts/stello_token_wrapper/Cargo.toml

test:
	cargo test --manifest-path contracts/Cargo.toml --workspace

demo-input:
	node circuits/generate_demo_input.mjs

demo-proof: circuits demo-input
	node sdk/node_modules/snarkjs/build/cli.cjs groth16 fullprove circuits/build/demo-input.json circuits/build/identity_verifier_js/identity_verifier.wasm circuits/build/identity_verifier_final.zkey circuits/build/demo-proof.json circuits/build/demo-public.json
	node sdk/node_modules/snarkjs/build/cli.cjs groth16 verify circuits/build/verification_key.json circuits/build/demo-public.json circuits/build/demo-proof.json
