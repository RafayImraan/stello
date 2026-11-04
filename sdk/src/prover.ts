import { groth16 } from "snarkjs";
import { createHash } from "node:crypto";
import { Address } from "@stellar/stellar-sdk";
import type { Proof, PublicSignals } from "snarkjs";

export interface ProofBundle { proof: Proof; publicSignals: PublicSignals; proofBytes: Uint8Array; publicInputs: Uint8Array[] }

/** Matches the registry's SHA256(ScVal(Address) XDR), truncated to 248 bits. */
export function hashSorobanAddress(accountId: string): string {
  const xdr = new Address(accountId).toScVal().toXDR();
  const digest = createHash("sha256").update(xdr).digest();
  return BigInt(`0x00${digest.subarray(0, 31).toString("hex")}`).toString(10);
}

function bigint32(value: string | number | bigint): Uint8Array {
  const n = BigInt(value);
  if (n < 0n || n >= (1n << 256n)) throw new RangeError("Public signal is outside uint256 range");
  const out = new Uint8Array(32);
  let x = n;
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 255n); x >>= 8n; }
  return out;
}

function coordinate(value: string): Uint8Array { return bigint32(value); }

/** Generates locally; artifacts must come from the matching circuit and trusted setup. */
export async function generateIdentityProof(input: Record<string, unknown>, wasmPath = "circuits/build/identity_verifier_js/identity_verifier.wasm", zkeyPath = "circuits/build/identity_verifier_final.zkey"): Promise<ProofBundle> {
  const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
  // Ethereum/snarkjs ordering, big endian: A(x,y), B(x.c1,x.c0,y.c1,y.c0), C(x,y).
  const parts = [coordinate(proof.pi_a[0]), coordinate(proof.pi_a[1]), coordinate(proof.pi_b[0][1]), coordinate(proof.pi_b[0][0]), coordinate(proof.pi_b[1][1]), coordinate(proof.pi_b[1][0]), coordinate(proof.pi_c[0]), coordinate(proof.pi_c[1])];
  const proofBytes = new Uint8Array(256);
  let offset = 0;
  for (const part of parts) { proofBytes.set(part, offset); offset += part.length; }
  if (proofBytes.length !== 256 || publicSignals.length !== 5) throw new Error("Unexpected circuit artifact shape; expected Groth16 BN254 and five public signals");
  return { proof, publicSignals, proofBytes, publicInputs: publicSignals.map(bigint32) };
}
