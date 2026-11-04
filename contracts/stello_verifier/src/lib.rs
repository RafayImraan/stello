#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Bn254Fr}, vec, Address, Bytes, BytesN, Env, Vec};

const FP_MODULUS: [u8; 32] = [
    0x30,0x64,0x4e,0x72,0xe1,0x31,0xa0,0x29,0xb8,0x50,0x45,0xb6,0x81,0x81,0x58,0x5d,
    0x97,0x81,0x6a,0x91,0x68,0x71,0xca,0x8d,0x3c,0x20,0x8c,0x16,0xd8,0x7c,0xfd,0x47,
];

fn negate_g1(env: &Env, point: &BytesN<64>) -> BytesN<64> {
    let raw = point.to_array();
    let mut out = raw;
    let mut y = [0u8; 32];
    y.copy_from_slice(&raw[32..64]);
    if y.iter().all(|b| *b == 0) { return point.clone(); }
    let mut borrow = 0u16;
    for i in (0..32).rev() {
        let lhs = FP_MODULUS[i] as u16;
        let rhs = y[i] as u16 + borrow;
        if lhs >= rhs { out[32 + i] = (lhs - rhs) as u8; borrow = 0; }
        else { out[32 + i] = (lhs + 256 - rhs) as u8; borrow = 1; }
    }
    BytesN::from_array(env, &out)
}

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u32)]
pub enum VerifierError { NotInitialized = 1, InvalidKey = 2, MalformedProof = 3, WrongInputCount = 4 }

#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha1: BytesN<64>,
    pub beta2: BytesN<128>,
    pub gamma2: BytesN<128>,
    pub delta2: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
#[derive(Clone)]
enum StorageKey { Admin, Vk }

#[contract]
pub struct StelloVerifier;

#[contractimpl]
impl StelloVerifier {
    pub fn initialize(env: Env, admin: Address, key: VerificationKey) -> Result<(), VerifierError> {
        if env.storage().instance().has(&StorageKey::Vk) { return Err(VerifierError::InvalidKey); }
        admin.require_auth();
        if key.ic.len() != 6 { return Err(VerifierError::WrongInputCount); }
        env.storage().instance().set(&StorageKey::Admin, &admin);
        env.storage().instance().set(&StorageKey::Vk, &key);
        env.storage().instance().extend_ttl(100_000, 200_000);
        Ok(())
    }

    pub fn verify_proof(env: Env, proof: Bytes, public_inputs: Vec<BytesN<32>>) -> Result<bool, VerifierError> {
        let key: VerificationKey = env.storage().instance().get(&StorageKey::Vk).ok_or(VerifierError::NotInitialized)?;
        if public_inputs.len() != 5 { return Err(VerifierError::WrongInputCount); }
        if proof.len() != 256 { return Err(VerifierError::MalformedProof); }
        let a = Bn254G1Affine::from_bytes(proof.slice(0..64).try_into().map_err(|_| VerifierError::MalformedProof)?);
        let b = Bn254G2Affine::from_bytes(proof.slice(64..192).try_into().map_err(|_| VerifierError::MalformedProof)?);
        let c = Bn254G1Affine::from_bytes(proof.slice(192..256).try_into().map_err(|_| VerifierError::MalformedProof)?);
        let mut points = Vec::new(&env);
        points.push_back(Bn254G1Affine::from_bytes(key.ic.get(0).ok_or(VerifierError::WrongInputCount)?));
        let mut scalars = Vec::new(&env);
        let mut one = [0u8; 32]; one[31] = 1;
        scalars.push_back(Bn254Fr::from_bytes(BytesN::from_array(&env, &one)));
        for (i, input) in public_inputs.iter().enumerate() {
            points.push_back(Bn254G1Affine::from_bytes(key.ic.get(i as u32 + 1).ok_or(VerifierError::WrongInputCount)?));
            scalars.push_back(soroban_sdk::crypto::bn254::Bn254Fr::from_bytes(input));
        }
        let acc = env.crypto().bn254().g1_msm(&points, &scalars).map_err(|_| VerifierError::MalformedProof)?;
        let neg_alpha = negate_g1(&env, &key.alpha1);
        let neg_acc = negate_g1(&env, &acc.to_bytes());
        let neg_c = negate_g1(&env, &c.to_bytes());
        let g1 = vec![&env, a, Bn254G1Affine::from_bytes(neg_alpha), Bn254G1Affine::from_bytes(neg_acc), Bn254G1Affine::from_bytes(neg_c)];
        let g2 = vec![&env, b, Bn254G2Affine::from_bytes(key.beta2), Bn254G2Affine::from_bytes(key.gamma2), Bn254G2Affine::from_bytes(key.delta2)];
        env.crypto().bn254().pairing_check(&g1, &g2).map_err(|_| VerifierError::MalformedProof)
    }
}

