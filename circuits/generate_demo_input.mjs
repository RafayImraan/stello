import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { Address } = require("../sdk/node_modules/@stellar/stellar-sdk");

const root = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(root, "build");
await mkdir(outputDir, { recursive: true });
const { Scalar } = require("../sdk/node_modules/ffjavascript");
const createBlakeHash = require("../sdk/node_modules/blake-hash");
const { buildBabyjub, buildPoseidon } = require("../sdk/node_modules/circomlibjs");
const [yearArg, ageArg, addressArg] = process.argv.slice(2);
const currentYear = Number(yearArg ?? new Date().getUTCFullYear());
const minAge = Number(ageArg ?? 18);
if (!Number.isInteger(currentYear) || currentYear < 2000 || currentYear > 9999) throw new RangeError("Year must be an integer from 2000 through 9999");
if (!Number.isInteger(minAge) || minAge < 0 || minAge > 120) throw new RangeError("Minimum age must be an integer from 0 through 120");

const poseidon = await buildPoseidon();
const babyJub = await buildBabyjub();
const fieldValue = (value) => typeof value === "bigint" ? value : poseidon.F.toObject(value);
const fieldString = (value) => poseidon.F.toString(typeof value === "bigint" ? poseidon.F.e(value) : value);
const fieldHex = (value) => BigInt(fieldString(value)).toString(16).padStart(64, "0");
const hash = (values) => poseidon.F.toObject(poseidon(values.map(fieldValue)));
const randomField = () => BigInt(`0x${randomBytes(31).toString("hex")}`);

let userAddressHash;
if (addressArg) {
  const addressXdr = new Address(addressArg).toScVal().toXDR();
  const digest = createHash("sha256").update(addressXdr).digest();
  userAddressHash = BigInt(`0x00${digest.subarray(0, 31).toString("hex")}`);
} else {
  userAddressHash = randomField();
}

const userBirthYear = Math.min(1990, currentYear - minAge);
if (userBirthYear + minAge > currentYear) throw new Error("Chosen birth year does not satisfy the age policy");
const userSecret = randomField();
const issuerSecret = randomBytes(32);
function pruneBuffer(buffer) {
  buffer[0] &= 0xf8;
  buffer[31] &= 0x7f;
  buffer[31] |= 0x40;
  return buffer;
}
function privateScalar(secret) {
  const clamped = pruneBuffer(Buffer.from(createBlakeHash("blake512").update(secret).digest()));
  return { clamped, scalar: Scalar.fromRprLE(clamped, 0, 32) };
}
const { clamped, scalar: issuerScalar } = privateScalar(issuerSecret);
const issuerPublicKey = babyJub.mulPointEscalar(babyJub.Base8, Scalar.shr(issuerScalar, 3));
const issuerCommitment = hash(issuerPublicKey);
const secretCommitment = hash([userAddressHash, userSecret]);
const attributes = hash([userAddressHash, BigInt(userBirthYear), secretCommitment, BigInt(currentYear)]);
const message = babyJub.F.e(attributes);
const nonceBytes = new Uint8Array(32 + message.length);
nonceBytes.set(clamped.slice(32));
babyJub.F.toRprLE(nonceBytes, 32, message);
const nonceDigest = createBlakeHash("blake512").update(Buffer.from(nonceBytes)).digest();
const nonce = Scalar.mod(Scalar.fromRprLE(nonceDigest, 0, 64), babyJub.subOrder);
const R8 = babyJub.mulPointEscalar(babyJub.Base8, nonce);
const challenge = poseidon([R8[0], R8[1], issuerPublicKey[0], issuerPublicKey[1], message]);
const challengeScalar = Scalar.e(babyJub.F.toObject(challenge));
const signature = { R8, S: Scalar.mod(Scalar.add(nonce, Scalar.mul(challengeScalar, issuerScalar)), babyJub.subOrder) };
const lhs = babyJub.mulPointEscalar(babyJub.Base8, signature.S);
const rhs = babyJub.addPoint(signature.R8, babyJub.mulPointEscalar(issuerPublicKey, Scalar.mul(challengeScalar, 8)));
if (!babyJub.F.eq(lhs[0], rhs[0]) || !babyJub.F.eq(lhs[1], rhs[1])) throw new Error("Generated issuer signature failed self-verification");

const sanctionsListMerklePath = Array(248).fill("0");
let sanctionsMerkleRoot = 0n;
for (let i = 0; i < sanctionsListMerklePath.length; i++) sanctionsMerkleRoot = hash([sanctionsMerkleRoot, 0n]);

const input = {
  currentYear,
  minAge,
  sanctionsMerkleRoot: fieldString(sanctionsMerkleRoot),
  issuerPublicKey: fieldString(issuerCommitment),
  issuerPublicKeyX: fieldString(issuerPublicKey[0]),
  issuerPublicKeyY: fieldString(issuerPublicKey[1]),
  userAddressHash: userAddressHash.toString(),
  userBirthYear,
  userSecret: userSecret.toString(),
  sanctionsListMerklePath,
  signature: [fieldString(signature.R8[0]), fieldString(signature.R8[1]), signature.S.toString()],
};

await writeFile(path.join(outputDir, "demo-input.json"), `${JSON.stringify(input, null, 2)}\n`, { flag: "w" });
await writeFile(path.join(outputDir, "demo-policy.json"), `${JSON.stringify({ issuerCommitment: fieldString(issuerCommitment), issuerCommitmentHex: fieldHex(issuerCommitment), sanctionsRoot: fieldString(sanctionsMerkleRoot), sanctionsRootHex: fieldHex(sanctionsMerkleRoot), currentYear, minAge, walletBound: Boolean(addressArg) }, null, 2)}\n`, { flag: "w" });
console.log(`Demo witness: ${path.join(outputDir, "demo-input.json")}`);
console.log(`Demo policy: ${path.join(outputDir, "demo-policy.json")}`);
console.log(`Issuer commitment (decimal): ${fieldString(issuerCommitment)}`);
console.log(`Issuer commitment (hex): ${fieldHex(issuerCommitment)}`);
console.log(`Sanctions root (decimal): ${fieldString(sanctionsMerkleRoot)}`);
console.log(`Sanctions root (hex): ${fieldHex(sanctionsMerkleRoot)}`);
if (!addressArg) console.warn("No Stellar address supplied; this witness cannot be registered to a wallet.");
console.warn("The generated issuer is ephemeral and the empty sanctions tree is demonstration-only.");
