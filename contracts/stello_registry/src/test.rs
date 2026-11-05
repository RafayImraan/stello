#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, BytesN, Env};

#[test]
fn initializes_and_reports_unverified_user() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let id = env.register(StelloRegistry, ());
    let client = StelloRegistryClient::new(&env, &id);
    env.mock_all_auths();
    client
        .initialize(
            &admin,
            &verifier,
            &BytesN::from_array(&env, &[1; 32]),
            &BytesN::from_array(&env, &[2; 32]),
            &2026,
            &18,
        )
        .unwrap();
    assert!(!client.is_verified(&Address::generate(&env), &1));
}
