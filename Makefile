.PHONY: circuits build test

circuits:
	cd circuits && bash build_circuits.sh

build:
	stellar contract build --manifest-path contracts/stello_verifier/Cargo.toml
	stellar contract build --manifest-path contracts/stello_registry/Cargo.toml
	stellar contract build --manifest-path contracts/stello_token_wrapper/Cargo.toml

test:
	cargo test --manifest-path contracts/Cargo.toml --workspace
