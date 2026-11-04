import { Address, Contract, rpc, TransactionBuilder, xdr, type Account } from "@stellar/stellar-sdk";
import { hashSorobanAddress, type ProofBundle } from "./prover.js";

export interface StelloConfig { rpcUrl: string; networkPassphrase: string; registryId: string; wrapperId: string }

export class StelloClient {
  readonly rpc: rpc.Server;
  constructor(readonly config: StelloConfig) { this.rpc = new rpc.Server(config.rpcUrl); }

  private invoke(source: Account, contractId: string, method: string, args: xdr.ScVal[]) {
    const contract = new Contract(contractId);
    return new TransactionBuilder(source, { fee: "100000", networkPassphrase: this.config.networkPassphrase })
      .addOperation(contract.call(method, ...args)).setTimeout(60).build();
  }

  async registerIdentity(source: Account, proof: ProofBundle, validitySeconds: bigint) {
    if (proof.publicSignals.length !== 5 || BigInt(String(proof.publicSignals[4])) !== BigInt(hashSorobanAddress(source.accountId()))) {
      throw new Error("Proof is not bound to the registering Stellar address");
    }
    const args = [new Address(source.accountId()).toScVal(), xdr.ScVal.scvBytes(Buffer.from(proof.proofBytes)), xdr.ScVal.scvVec(proof.publicInputs.map((b) => xdr.ScVal.scvBytes(Buffer.from(b)))), xdr.ScVal.scvU64(validitySeconds)];
    return this.invoke(source, this.config.registryId, "register_identity", args);
  }

  async compliantTransfer(source: Account, destination: string, amount: bigint) {
    const parts = xdr.bigIntTo128Parts(amount, true);
    const args = [new Address(source.accountId()).toScVal(), new Address(destination).toScVal(), xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: parts.hi, lo: parts.lo }))];
    return this.invoke(source, this.config.wrapperId, "transfer", args);
  }

  async simulate(transaction: Awaited<ReturnType<StelloClient["registerIdentity"]>>) {
    return this.rpc.simulateTransaction(transaction);
  }
}
