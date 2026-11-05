import { Address, Contract, rpc, scValToNative, TransactionBuilder, xdr, type Account, type Transaction } from "@stellar/stellar-sdk";
import { hashSorobanAddress, type ProofBundle } from "./prover.js";

export interface StelloConfig { rpcUrl: string; networkPassphrase: string; registryId: string; wrapperId: string }
export type TransactionSigner = (preparedTransactionXdr: string) => Promise<string>;

export class StelloClient {
  readonly rpc: rpc.Server;
  constructor(readonly config: StelloConfig) { this.rpc = new rpc.Server(config.rpcUrl); }

  private invoke(source: Account, contractId: string, method: string, args: xdr.ScVal[]) {
    const contract = new Contract(contractId);
    return new TransactionBuilder(source, { fee: "100000", networkPassphrase: this.config.networkPassphrase })
      .addOperation(contract.call(method, ...args)).setTimeout(60).build();
  }

  async registerIdentity(source: Account, proof: ProofBundle, validitySeconds: bigint) {
    if (validitySeconds <= 0n || validitySeconds > 15_552_000n) throw new RangeError("Identity validity must be between 1 second and 180 days");
    if (proof.publicSignals.length !== 5 || BigInt(String(proof.publicSignals[4])) !== BigInt(await hashSorobanAddress(source.accountId()))) {
      throw new Error("Proof is not bound to the registering Stellar address");
    }
    const args = [new Address(source.accountId()).toScVal(), xdr.ScVal.scvBytes(proof.proofBytes), xdr.ScVal.scvVec(proof.publicInputs.map((b) => xdr.ScVal.scvBytes(b))), xdr.ScVal.scvU64(validitySeconds)];
    return this.invoke(source, this.config.registryId, "register_identity", args);
  }

  async compliantTransfer(source: Account, destination: string, amount: bigint) {
    if (amount <= 0n) throw new RangeError("Transfer amount must be positive");
    const parts = xdr.bigIntTo128Parts(amount, true);
    const args = [new Address(source.accountId()).toScVal(), new Address(destination).toScVal(), xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: parts.hi, lo: parts.lo }))];
    return this.invoke(source, this.config.wrapperId, "transfer", args);
  }

  async simulate(transaction: Awaited<ReturnType<StelloClient["registerIdentity"]>>) {
    return this.rpc.simulateTransaction(transaction);
  }

  async isVerified(source: Account, user = source.accountId(), requiredLevel = 1): Promise<boolean> {
    if (!Number.isInteger(requiredLevel) || requiredLevel < 0 || requiredLevel > 0xffff_ffff) throw new RangeError("requiredLevel must be a uint32");
    const tx = this.invoke(source, this.config.registryId, "is_verified", [
      new Address(user).toScVal(),
      xdr.ScVal.scvU32(requiredLevel),
    ]);
    const simulation = await this.rpc.simulateTransaction(tx);
    if ("error" in simulation) throw new Error(`Registry query failed: ${simulation.error}`);
    const retval = simulation.result?.retval;
    if (!retval) throw new Error("Registry query returned no value");
    const value: unknown = scValToNative(retval);
    if (typeof value !== "boolean") throw new Error("Registry returned an unexpected value");
    return value;
  }

  async submit(transaction: Transaction, sign: TransactionSigner): Promise<string> {
    const prepared = await this.rpc.prepareTransaction(transaction);
    const signedXdr = await sign(prepared.toXDR());
    const signed = TransactionBuilder.fromXDR(signedXdr, this.config.networkPassphrase);
    if (!signed) throw new Error("Wallet returned an invalid signed transaction");
    const response = await this.rpc.sendTransaction(signed);
    if (response.status === "ERROR") throw new Error(`Transaction submission failed: ${JSON.stringify(response)}`);
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await this.rpc.getTransaction(response.hash);
      if (result.status === "SUCCESS") return response.hash;
      if (result.status === "FAILED") throw new Error(`Transaction failed on-ledger: ${JSON.stringify(result)}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`Transaction is still pending: ${response.hash}`);
  }
}
