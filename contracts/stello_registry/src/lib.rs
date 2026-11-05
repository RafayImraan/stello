#![no_std]
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, xdr::ToXdr, Address,
    Bytes, BytesN, Env, Vec,
};

#[cfg(test)]
mod test;

#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn verify_proof(env: Env, proof: Bytes, public_inputs: Vec<BytesN<32>>) -> bool;
}

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidDuration = 3,
    InvalidProof = 4,
    InvalidPolicy = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityState {
    pub expiry_timestamp: u64,
    pub compliance_level: u32,
    pub policy_version: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Verifier,
    Issuer,
    SanctionsRoot,
    CurrentYear,
    MinAge,
    PolicyVersion,
    User(Address),
}

#[contract]
pub struct StelloRegistry;

const INSTANCE_TTL_THRESHOLD: u32 = 4_000_000;
const INSTANCE_TTL_EXTEND: u32 = 5_000_000;
const PERSISTENT_TTL_THRESHOLD: u32 = 4_000_000;
const PERSISTENT_TTL_EXTEND: u32 = 5_000_000;

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}

#[contractimpl]
impl StelloRegistry {
    pub fn initialize(
        env: Env,
        admin: Address,
        verifier_contract: Address,
        issuer_key: BytesN<32>,
        sanctions_root: BytesN<32>,
        current_year: u32,
        min_age: u32,
    ) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        if min_age > 120 || current_year < 2000 || current_year > 9999 {
            return Err(RegistryError::InvalidPolicy);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Verifier, &verifier_contract);
        env.storage().instance().set(&DataKey::Issuer, &issuer_key);
        env.storage()
            .instance()
            .set(&DataKey::SanctionsRoot, &sanctions_root);
        env.storage()
            .instance()
            .set(&DataKey::CurrentYear, &current_year);
        env.storage().instance().set(&DataKey::MinAge, &min_age);
        env.storage().instance().set(&DataKey::PolicyVersion, &0u32);
        bump_instance(&env);
        Ok(())
    }

    pub fn register_identity(
        env: Env,
        user: Address,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
        validity_duration: u64,
    ) -> Result<(), RegistryError> {
        bump_instance(&env);
        if validity_duration == 0 || validity_duration > 15_552_000 {
            return Err(RegistryError::InvalidDuration);
        }
        user.require_auth();
        if public_inputs.len() != 5 {
            return Err(RegistryError::InvalidProof);
        }
        let issuer: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Issuer)
            .ok_or(RegistryError::NotInitialized)?;
        let sanctions_root: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::SanctionsRoot)
            .ok_or(RegistryError::NotInitialized)?;
        let current_year: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentYear)
            .ok_or(RegistryError::NotInitialized)?;
        let min_age: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinAge)
            .ok_or(RegistryError::NotInitialized)?;
        if public_inputs.get(0) != Some(field_u32(&env, current_year))
            || public_inputs.get(1) != Some(field_u32(&env, min_age))
            || public_inputs.get(2) != Some(sanctions_root)
            || public_inputs.get(3) != Some(issuer)
            || public_inputs.get(4) != Some(address_commitment(&env, &user))
        {
            return Err(RegistryError::InvalidPolicy);
        }
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(RegistryError::NotInitialized)?;
        let client = VerifierClient::new(&env, &verifier);
        let valid = client.verify_proof(&proof, &public_inputs);
        if !valid {
            return Err(RegistryError::InvalidProof);
        }
        // The current circuit proves the baseline identity policy only.
        let level: u32 = 1;
        let policy_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PolicyVersion)
            .ok_or(RegistryError::NotInitialized)?;
        let expiry_timestamp = env
            .ledger()
            .timestamp()
            .checked_add(validity_duration)
            .ok_or(RegistryError::InvalidDuration)?;
        env.storage().persistent().set(
            &DataKey::User(user.clone()),
            &IdentityState {
                expiry_timestamp,
                compliance_level: level,
                policy_version,
            },
        );
        env.storage().persistent().extend_ttl(
            &DataKey::User(user),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND,
        );
        Ok(())
    }

    pub fn is_verified(env: Env, user: Address, required_level: u32) -> bool {
        bump_instance(&env);
        let key = DataKey::User(user);
        let state: Option<IdentityState> = env.storage().persistent().get(&key);
        if state.is_some() {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_TTL_THRESHOLD,
                PERSISTENT_TTL_EXTEND,
            );
        }
        let policy_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PolicyVersion)
            .unwrap_or(u32::MAX);
        state
            .map(|s| {
                s.expiry_timestamp > env.ledger().timestamp()
                    && s.compliance_level >= required_level
                    && s.policy_version == policy_version
            })
            .unwrap_or(false)
    }

    pub fn revoke_identity(env: Env, user: Address) -> Result<(), RegistryError> {
        bump_instance(&env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        admin.require_auth();
        env.storage().persistent().remove(&DataKey::User(user));
        Ok(())
    }

    pub fn update_policy(
        env: Env,
        issuer_key: BytesN<32>,
        sanctions_root: BytesN<32>,
        current_year: u32,
        min_age: u32,
    ) -> Result<(), RegistryError> {
        bump_instance(&env);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        admin.require_auth();
        if min_age > 120 || current_year < 2000 || current_year > 9999 {
            return Err(RegistryError::InvalidPolicy);
        }
        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PolicyVersion)
            .ok_or(RegistryError::NotInitialized)?;
        let next_version = current_version
            .checked_add(1)
            .ok_or(RegistryError::InvalidPolicy)?;
        env.storage().instance().set(&DataKey::Issuer, &issuer_key);
        env.storage()
            .instance()
            .set(&DataKey::SanctionsRoot, &sanctions_root);
        env.storage()
            .instance()
            .set(&DataKey::CurrentYear, &current_year);
        env.storage().instance().set(&DataKey::MinAge, &min_age);
        env.storage()
            .instance()
            .set(&DataKey::PolicyVersion, &next_version);
        Ok(())
    }
}

fn field_u32(env: &Env, value: u32) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[28..32].copy_from_slice(&value.to_be_bytes());
    BytesN::from_array(env, &bytes)
}

// Domain and encoding are fixed: SHA-256 of Soroban ScVal XDR, truncated to
// 248 bits (left padded to 32 bytes) so the result is always a BN254 scalar.
fn address_commitment(env: &Env, user: &Address) -> BytesN<32> {
    let encoded = user.clone().to_xdr(env);
    let digest = env.crypto().sha256(&encoded);
    let mut out = [0u8; 32];
    let digest_bytes = digest.to_array();
    for i in 0..31 {
        out[i + 1] = digest_bytes[i];
    }
    BytesN::from_array(env, &out)
}
