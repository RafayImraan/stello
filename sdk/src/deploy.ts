import { readFile } from "node:fs/promises";
import {
  Address,
  Contract,
  Keypair,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

interface VerificationKeyJson {
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
}

export interface TestnetSetup {
  rpcUrl: string;
  networkPassphrase: string;
  adminSecret: string;
  verifierId: string;
  registryId: string;
  wrapperId: string;
  verificationKeyPath: string;
  issuerCommitment: string;
  sanctionsRoot: string;
  currentYear: number;
  minAge: number;
  requiredLevel?: number;
}

function fixedHex(value: string, width: number): Buffer {
  const n = BigInt(value);
  if (n < 0n || n >= 1n << BigInt(width * 8)) throw new RangeError("Verification key coordinate is out of range");
  return Buffer.from(n.toString(16).padStart(width * 2, "0"), "hex");
}

function g1(point: string[]): Buffer {
  if (point.length < 2) throw new Error("Malformed G1 point in verification key");
  return Buffer.concat([fixedHex(point[0]!, 32), fixedHex(point[1]!, 32)]);
}

// Soroban's BN254 host encoding uses the same c1,c0 ordering as prover.ts.
function g2(point: string[][]): Buffer {
  if (point.length < 2 || point[0]!.length < 2 || point[1]!.length < 2) throw new Error("Malformed G2 point in verification key");
  return Buffer.concat([
    fixedHex(point[0]![1]!, 32), fixedHex(point[0]![0]!, 32),
    fixedHex(point[1]![1]!, 32), fixedHex(point[1]![0]!, 32),
  ]);
}

function keyScVal(key: VerificationKeyJson): xdr.ScVal {
  if (key.IC.length !== 6) throw new Error(`Expected six Groth16 IC points for five public inputs; got ${key.IC.length}`);
  const entries: [string, xdr.ScVal][] = [
    ["alpha1", xdr.ScVal.scvBytes(g1(key.vk_alpha_1))],
    ["beta2", xdr.ScVal.scvBytes(g2(key.vk_beta_2))],
    ["gamma2", xdr.ScVal.scvBytes(g2(key.vk_gamma_2))],
    ["delta2", xdr.ScVal.scvBytes(g2(key.vk_delta_2))],
    ["ic", xdr.ScVal.scvVec(key.IC.map((p) => xdr.ScVal.scvBytes(g1(p))))],
  ];
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return xdr.ScVal.scvMap(entries.map(([name, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val })));
}

function bytes32(hex: string, name: string): xdr.ScVal {
  const clean = hex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error(`${name} must be exactly 32 bytes of hex`);
  return xdr.ScVal.scvBytes(Buffer.from(clean, "hex"));
}

async function invoke(
  server: rpc.Server,
  keypair: Keypair,
  passphrase: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  const source = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(source, { fee: "100000", networkPassphrase: passphrase })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(180)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`Submitting ${method} failed: ${JSON.stringify(sent)}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return sent.hash;
    if (result.status === "FAILED") throw new Error(`${method} failed on-ledger: ${JSON.stringify(result)}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${method} is still pending; transaction hash ${sent.hash}`);
}

/** Initialize already-deployed testnet contracts in dependency order. */
export async function initializeTestnet(config: TestnetSetup): Promise<{ verifier: string; registry: string; wrapper: string }> {
  if (!Number.isInteger(config.currentYear) || config.currentYear < 2000 || config.currentYear > 9999) throw new RangeError("currentYear must be an integer from 2000 through 9999");
  if (!Number.isInteger(config.minAge) || config.minAge < 0 || config.minAge > 120) throw new RangeError("minAge must be an integer from 0 through 120");
  if (config.requiredLevel !== undefined && (!Number.isInteger(config.requiredLevel) || config.requiredLevel < 0)) throw new RangeError("requiredLevel must be a non-negative integer");
  const issuer = bytes32(config.issuerCommitment, "STELLO_ISSUER_COMMITMENT");
  const sanctions = bytes32(config.sanctionsRoot, "STELLO_SANCTIONS_ROOT");
  const verifierAddress = new Address(config.verifierId);
  const registryAddress = new Address(config.registryId);
  new Address(config.wrapperId);
  const keypair = Keypair.fromSecret(config.adminSecret);
  const server = new rpc.Server(config.rpcUrl);
  const keyJson = JSON.parse(await readFile(config.verificationKeyPath, "utf8")) as VerificationKeyJson;
  const verificationKey = keyScVal(keyJson);
  const admin = new Address(keypair.publicKey()).toScVal();
  const verifier = await invoke(server, keypair, config.networkPassphrase, config.verifierId, "initialize", [admin, verificationKey]);
  const registry = await invoke(server, keypair, config.networkPassphrase, config.registryId, "initialize", [
    admin,
    verifierAddress.toScVal(),
    issuer,
    sanctions,
    xdr.ScVal.scvU32(config.currentYear),
    xdr.ScVal.scvU32(config.minAge),
  ]);
  const wrapper = await invoke(server, keypair, config.networkPassphrase, config.wrapperId, "initialize", [
    admin,
    registryAddress.toScVal(),
    xdr.ScVal.scvU32(config.requiredLevel ?? 1),
  ]);
  return { verifier, registry, wrapper };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before initializing the testnet contracts`);
  return value;
}

/** Run with node dist/deploy.js after deployments and policy values are ready. */
async function main(): Promise<void> {
  const result = await initializeTestnet({
    rpcUrl: process.env.STELLO_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: process.env.STELLO_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    adminSecret: requiredEnv("STELLO_ADMIN_SECRET"),
    verifierId: requiredEnv("STELLO_VERIFIER_ID"),
    registryId: requiredEnv("STELLO_REGISTRY_ID"),
    wrapperId: requiredEnv("STELLO_WRAPPER_ID"),
    verificationKeyPath: process.env.STELLO_VERIFICATION_KEY ?? "../circuits/build/verification_key.json",
    issuerCommitment: requiredEnv("STELLO_ISSUER_COMMITMENT"),
    sanctionsRoot: requiredEnv("STELLO_SANCTIONS_ROOT"),
    currentYear: Number(process.env.STELLO_CURRENT_YEAR ?? new Date().getUTCFullYear()),
    minAge: Number(process.env.STELLO_MIN_AGE ?? "18"),
    requiredLevel: Number(process.env.STELLO_REQUIRED_LEVEL ?? "1"),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/deploy.js")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
