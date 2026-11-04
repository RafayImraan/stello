#![no_std]
use soroban_sdk::{contract, contractclient, contracterror, contractimpl, contracttype, Address, Env};

#[contractclient(name = "RegistryClient")]
pub trait RegistryInterface { fn is_verified(env: Env, user: Address, required_level: u32) -> bool; }

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq)]
#[repr(u32)]
pub enum WrapperError { AlreadyInitialized = 1, NotInitialized = 2, NotCompliant = 3, InvalidAmount = 4, InsufficientBalance = 5, InsufficientAllowance = 6, Overflow = 7 }

#[contracttype]
#[derive(Clone)]
enum Key { Admin, Registry, Level, Balance(Address), Allowance(Address, Address), Supply }

#[contract]
pub struct StelloTokenWrapper;

fn is_compliant(env: &Env, registry: &Address, user: &Address, level: u32) -> bool {
    RegistryClient::new(env, registry).is_verified(user, &level)
}

fn balance(env: &Env, owner: &Address) -> i128 {
    env.storage().persistent().get(&Key::Balance(owner.clone())).unwrap_or(0)
}

fn write_balance(env: &Env, owner: &Address, amount: i128) {
    let key = Key::Balance(owner.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage().persistent().extend_ttl(&key, 100_000, 200_000);
}

fn move_tokens(env: &Env, from: &Address, to: &Address, amount: i128) -> Result<(), WrapperError> {
    if amount < 0 { return Err(WrapperError::InvalidAmount); }
    let from_balance = balance(env, from);
    if from_balance < amount { return Err(WrapperError::InsufficientBalance); }
    let to_balance = balance(env, to);
    let next_to = to_balance.checked_add(amount).ok_or(WrapperError::Overflow)?;
    write_balance(env, from, from_balance - amount);
    write_balance(env, to, next_to);
    Ok(())
}

#[contractimpl]
impl StelloTokenWrapper {
    pub fn initialize(env: Env, admin: Address, registry: Address, required_level: u32) -> Result<(), WrapperError> {
        if env.storage().instance().has(&Key::Admin) { return Err(WrapperError::AlreadyInitialized); }
        admin.require_auth();
        env.storage().instance().set(&Key::Admin, &admin);
        env.storage().instance().set(&Key::Registry, &registry);
        env.storage().instance().set(&Key::Level, &required_level);
        env.storage().instance().set(&Key::Supply, &0i128);
        env.storage().instance().extend_ttl(100_000, 200_000);
        Ok(())
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), WrapperError> {
        from.require_auth();
        let registry: Address = env.storage().instance().get(&Key::Registry).ok_or(WrapperError::NotInitialized)?;
        let level: u32 = env.storage().instance().get(&Key::Level).ok_or(WrapperError::NotInitialized)?;
        if !is_compliant(&env, &registry, &from, level) || !is_compliant(&env, &registry, &to, level) { return Err(WrapperError::NotCompliant); }
        move_tokens(&env, &from, &to, amount)
    }

    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) -> Result<(), WrapperError> {
        owner.require_auth();
        if amount < 0 { return Err(WrapperError::InvalidAmount); }
        let key = Key::Allowance(owner, spender);
        env.storage().persistent().set(&key, &amount);
        env.storage().persistent().extend_ttl(&key, 100_000, 200_000);
        Ok(())
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) -> Result<(), WrapperError> {
        spender.require_auth();
        if amount < 0 { return Err(WrapperError::InvalidAmount); }
        let registry: Address = env.storage().instance().get(&Key::Registry).ok_or(WrapperError::NotInitialized)?;
        let level: u32 = env.storage().instance().get(&Key::Level).ok_or(WrapperError::NotInitialized)?;
        if !is_compliant(&env, &registry, &from, level) || !is_compliant(&env, &registry, &to, level) { return Err(WrapperError::NotCompliant); }
        let key = Key::Allowance(from.clone(), spender);
        let allowance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if allowance < amount { return Err(WrapperError::InsufficientAllowance); }
        move_tokens(&env, &from, &to, amount)?;
        env.storage().persistent().set(&key, &(allowance - amount));
        env.storage().persistent().extend_ttl(&key, 100_000, 200_000);
        Ok(())
    }

    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), WrapperError> {
        let admin: Address = env.storage().instance().get(&Key::Admin).ok_or(WrapperError::NotInitialized)?;
        admin.require_auth();
        if amount <= 0 { return Err(WrapperError::InvalidAmount); }
        let registry: Address = env.storage().instance().get(&Key::Registry).ok_or(WrapperError::NotInitialized)?;
        let level: u32 = env.storage().instance().get(&Key::Level).ok_or(WrapperError::NotInitialized)?;
        if !is_compliant(&env, &registry, &to, level) { return Err(WrapperError::NotCompliant); }
        let next_balance = balance(&env, &to).checked_add(amount).ok_or(WrapperError::Overflow)?;
        let supply: i128 = env.storage().instance().get(&Key::Supply).unwrap_or(0);
        let next_supply = supply.checked_add(amount).ok_or(WrapperError::Overflow)?;
        write_balance(&env, &to, next_balance);
        env.storage().instance().set(&Key::Supply, &next_supply);
        Ok(())
    }

    pub fn balance_of(env: Env, owner: Address) -> i128 { balance(&env, &owner) }
    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 { env.storage().persistent().get(&Key::Allowance(owner, spender)).unwrap_or(0) }
    pub fn total_supply(env: Env) -> i128 { env.storage().instance().get(&Key::Supply).unwrap_or(0) }
}
