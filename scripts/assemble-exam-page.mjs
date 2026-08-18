#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const partsDir = path.join(__dirname, "exam-page-parts");
const out = path.join(__dirname, "..", "src", "components", "exam-generator-page.tsx");
fs.mkdirSync(path.dirname(out), { recursive: true });

// Prefer zlib-compressed split (exam.z0.b64 + exam.z1.b64)
const z0 = path.join(partsDir, "exam.z0.b64");
const z1 = path.join(partsDir, "exam.z1.b64");
if (fs.existsSync(z0) && fs.existsSync(z1)) {
  const a = fs.readFileSync(z0, "utf8").trim();
  const b = fs.readFileSync(z1, "utf8").trim();
  const buf = zlib.inflateSync(Buffer.from(a + b, "base64"));
  fs.writeFileSync(out, buf);
  console.log("assemble-exam-page: wrote", out, `(${buf.length} bytes, zlib)`);
  process.exit(0);
}

// Fallback: numbered base64 parts
const parts = [];
for (let i = 0; ; i++) {
  const f = path.join(partsDir, `exam-generator-page.${i}.b64`);
  if (!fs.existsSync(f)) break;
  parts.push(fs.readFileSync(f, "utf8").trim());
}
if (!parts.length) {
  console.error("assemble-exam-page: no parts found in", partsDir);
  process.exit(1);
}
const buf = Buffer.from(parts.join(""), "base64");
fs.writeFileSync(out, buf);
console.log("assemble-exam-page: wrote", out, `(${buf.length} bytes, b64)`);
