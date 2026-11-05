import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const circuitsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(circuitsDir, "..");
const outDir = path.join(circuitsDir, "build");
const node = process.execPath;
const circom = path.join(rootDir, "sdk", "node_modules", "circom2", "cli.js");
const snarkjs = path.join(rootDir, "sdk", "node_modules", "snarkjs", "build", "cli.cjs");

async function run(script, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(node, [script, ...args], { cwd: circuitsDir, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited with ${code}`)));
  });
}

async function exists(file) {
  try { await access(file); return true; }
  catch { return false; }
}

await mkdir(outDir, { recursive: true });
await run(circom, ["identity_verifier.circom", "--r1cs", "--wasm", "--sym", "-l", "../sdk/node_modules", "-o", "build"]);

// The random contribution is local development material only, never a production ceremony.
const ptau0 = path.join(outDir, "pot17_0000.ptau");
const ptau1 = path.join(outDir, "pot17_0001.ptau");
const ptauFinal = path.join(outDir, "pot17_final.ptau");
const zkey0 = path.join(outDir, "identity_verifier_0000.zkey");
const zkeyFinal = path.join(outDir, "identity_verifier_final.zkey");
const vkey = path.join(outDir, "verification_key.json");
const manifest = path.join(outDir, "identity_verifier.r1cs.sha256");
const r1csHash = createHash("sha256").update(await readFile(path.join(outDir, "identity_verifier.r1cs"))).digest("hex");
const priorHash = await exists(manifest) ? (await readFile(manifest, "utf8")).trim() : "";
if (priorHash !== r1csHash) {
  await Promise.all([rm(zkey0, { force: true }), rm(zkeyFinal, { force: true }), rm(vkey, { force: true })]);
}
if (!(await exists(ptau0))) await run(snarkjs, ["powersoftau", "new", "bn128", "17", ptau0]);
if (!(await exists(ptau1))) await run(snarkjs, ["powersoftau", "contribute", ptau0, ptau1, "--name=local development", `-e=${randomBytes(32).toString("hex")}`]);
if (!(await exists(ptauFinal))) await run(snarkjs, ["powersoftau", "prepare", "phase2", ptau1, ptauFinal]);
if (!(await exists(zkey0)) && !(await exists(zkeyFinal))) await run(snarkjs, ["groth16", "setup", path.join(outDir, "identity_verifier.r1cs"), ptauFinal, zkey0]);
if (!(await exists(zkeyFinal))) await run(snarkjs, ["zkey", "contribute", zkey0, zkeyFinal, "--name=local development", `-e=${randomBytes(32).toString("hex")}`]);
if (!(await exists(vkey))) await run(snarkjs, ["zkey", "export", "verificationkey", zkeyFinal, vkey]);
await writeFile(manifest, `${r1csHash}\n`);
console.warn("Development artifacts generated. This local ceremony is not suitable for production.");
