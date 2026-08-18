#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const partsDir = path.join(__dirname, "exam-page-parts");
const parts = [];
for (let i = 0; ; i++) {
  const f = path.join(partsDir, `exam-generator-page.${i}.b64`);
  if (!fs.existsSync(f)) break;
  parts.push(fs.readFileSync(f, "utf8").trim());
}
if (!parts.length) {
  console.error("assemble-exam-page: no b64 parts in", partsDir);
  process.exit(1);
}
const out = path.join(__dirname, "..", "src", "components", "exam-generator-page.tsx");
fs.mkdirSync(path.dirname(out), { recursive: true });
const buf = Buffer.from(parts.join(""), "base64");
fs.writeFileSync(out, buf);
console.log("assemble-exam-page: wrote", out, `(${buf.length} bytes)`);
