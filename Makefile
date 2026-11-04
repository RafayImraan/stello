.PHONY: circuits build test

circuits:
	node circuits/build_circuits.mjs

build:
	stellar contract build --manifest-path contracts/stello_verifier/Cargo.toml
	stellar contract build --manifest-path contracts/stello_registry/Cargo.toml
	stellar contract build --manifest-path contracts/stello_token_wrapper/Cargo.toml

test:
	cargo test --manifest-path contracts/Cargo.toml --workspace
