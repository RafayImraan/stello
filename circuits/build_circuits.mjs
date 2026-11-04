import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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

await mkdir(outDir, { recursive: true });
await run(circom, ["identity_verifier.circom", "--r1cs", "--wasm", "--sym", "-l", "../sdk/node_modules", "-o", "build"]);

// The random contribution is local development material only, never a production ceremony.
await run(snarkjs, ["powersoftau", "new", "bn128", "17", path.join(outDir, "pot17_0000.ptau")]);
await run(snarkjs, ["powersoftau", "contribute", path.join(outDir, "pot17_0000.ptau"), path.join(outDir, "pot17_0001.ptau"), "--name=local development", `-e=${randomBytes(32).toString("hex")}`]);
await run(snarkjs, ["powersoftau", "prepare", "phase2", path.join(outDir, "pot17_0001.ptau"), path.join(outDir, "pot17_final.ptau")]);
await run(snarkjs, ["groth16", "setup", path.join(outDir, "identity_verifier.r1cs"), path.join(outDir, "pot17_final.ptau"), path.join(outDir, "identity_verifier_0000.zkey")]);
await run(snarkjs, ["zkey", "contribute", path.join(outDir, "identity_verifier_0000.zkey"), path.join(outDir, "identity_verifier_final.zkey"), "--name=local development", `-e=${randomBytes(32).toString("hex")}`]);
await run(snarkjs, ["zkey", "export", "verificationkey", path.join(outDir, "identity_verifier_final.zkey"), path.join(outDir, "verification_key.json")]);
console.warn("Development artifacts generated. This local ceremony is not suitable for production.");
