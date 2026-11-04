declare module "snarkjs" {
  export interface Proof { pi_a: string[]; pi_b: [string[], string[]]; pi_c: string[] }
  export type PublicSignals = string[];
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasmPath: string, zkeyPath: string): Promise<{ proof: Proof; publicSignals: PublicSignals }>;
  };
}
