#!/usr/bin/env node
/* eslint-disable no-console */

const DEFAULT_URL = process.env.EXPRESS_SERVER_URL || "http://localhost:3000";

function parseArgs(argv) {
  const out = { url: DEFAULT_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") out.url = argv[++i];
  }
  return out;
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("This script requires Node 18+ (global fetch).");
  }

  const { url } = parseArgs(process.argv.slice(2));
  const baseUrl = url.replace(/\/$/, "");

  const res = await fetch(`${baseUrl}/api/elements/clear`, {
    method: "DELETE",
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    throw new Error(`Failed to clear canvas: ${res.status} ${res.statusText} ${json?.error ? `- ${json.error}` : ""}`);
  }

  console.log(`Cleared canvas (${json.count} elements removed)`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
