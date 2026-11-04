.PHONY: circuits build test

circuits:
	cd circuits && bash build_circuits.sh

build:
	cargo build --manifest-path contracts/Cargo.toml --workspace --release --target wasm32v1-none

test:
	cargo test --manifest-path contracts/Cargo.toml --workspace
