import { sha256Canonical } from "./hash.mjs";

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

async function readInput() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_INPUT_BYTES) {
      const error = new Error("hash_input_too_large");
      error.code = "hash_input_too_large";
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

async function main() {
  const bytes = await readInput();
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const error = new Error("hash_invalid_utf8");
    error.code = "hash_invalid_utf8";
    throw error;
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    const error = new Error("hash_invalid_json");
    error.code = "hash_invalid_json";
    throw error;
  }

  process.stdout.write(`${JSON.stringify({ sha256: sha256Canonical(value) })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? "hash_cli_error"}\n`);
  process.exitCode = 1;
});
