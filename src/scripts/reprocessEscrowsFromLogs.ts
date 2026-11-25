import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import fetch from "node-fetch";
import * as config from "../util/config";

type EscrowFromLog = {
  account: string;
  sequence: number;
  finishafter?: string;
  testnet: boolean;
  [key: string]: any;
};

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const out: {
    logPath?: string;
    prefix?: string;
    dryRun: boolean;
    limit?: number;
  } = { dryRun: true };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--logPath" || a === "-p") out.logPath = args[++i];
    else if (a === "--prefix") out.prefix = args[++i];
    else if (a === "--apply") out.dryRun = false;
    else if (a === "--dryRun") out.dryRun = true;
    else if (a === "--limit") out.limit = parseInt(args[++i] || "", 10);
  }

  return out;
}

function listLogFiles(logPath: string, prefix?: string): string[] {
  const stat = fs.statSync(logPath);
  if (stat.isFile()) return [logPath];

  const files = fs
    .readdirSync(logPath)
    .filter((f) => (prefix ? f.startsWith(prefix) : true))
    .map((f) => path.join(logPath, f));

  // best effort: stable processing order
  files.sort();
  return files;
}

function readLogFileText(filePath: string): string {
  const buf = fs.readFileSync(filePath);

  // PM2 logrotate often stores as .gz
  if (filePath.toLowerCase().endsWith(".gz")) {
    const unzipped = zlib.gunzipSync(buf);
    return unzipped.toString("utf8");
  }

  return buf.toString("utf8");
}

function extractJsonAfterMarker(line: string, marker: string): any | null {
  const idx = line.indexOf(marker);
  if (idx === -1) return null;

  const jsonStr = line.substring(idx + marker.length).trim();
  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function escrowKey(e: EscrowFromLog) {
  return `${e.account}:${e.sequence}:${e.testnet ? "test" : "main"}`;
}

async function escrowExists(escrow: EscrowFromLog): Promise<boolean> {
  const base = config.TRANSACTION_EXECUTOR_API;
  const url =
    base +
    `/api/v1/escrowFinish/exists/${encodeURIComponent(escrow.account)}/${encodeURIComponent(
      String(escrow.sequence),
    )}/${encodeURIComponent(String(escrow.testnet))}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`exists check failed (${res.status})`);

  const json: any = await res.json();
  return Boolean(json?.success);
}

async function addEscrow(escrow: EscrowFromLog): Promise<boolean> {
  const base = config.TRANSACTION_EXECUTOR_API;
  const url = base + `/api/v1/escrowFinish`;

  const res = await fetch(url, { method: "post", body: JSON.stringify(escrow) });
  if (!res.ok) throw new Error(`add escrow failed (${res.status})`);

  const json: any = await res.json();
  return Boolean(json?.success);
}

async function main() {
  const { logPath, prefix, dryRun, limit } = parseArgs(process.argv);

  if (!logPath) {
    console.log(
      [
        "Usage:",
        "  node dist/scripts/reprocessEscrowsFromLogs.js --logPath <file-or-dir> [--prefix <filenamePrefix>] [--limit <n>] [--apply]",
        "",
        "Notes:",
        "  - Default is dry-run. Use --apply to actually insert.",
        "  - Requires TRANSACTION_EXECUTOR_API env var.",
      ].join("\n"),
    );
    process.exit(2);
  }

  if (!config.TRANSACTION_EXECUTOR_API || config.TRANSACTION_EXECUTOR_API.trim().length === 0) {
    console.log("ERROR: TRANSACTION_EXECUTOR_API env var is not set.");
    process.exit(2);
  }

  const files = listLogFiles(logPath, prefix);
  if (files.length === 0) {
    console.log("No log files found for given path/prefix.");
    process.exit(0);
  }

  const saveMarker = "[DB]: saveEscrow: escrow:";
  const errorMarker = "[DB]: error saveEscrow";

  let lastSeenEscrow: EscrowFromLog | null = null;
  const failedByKey = new Map<string, EscrowFromLog>();

  for (const file of files) {
    let content: string;
    try {
      content = readLogFileText(file);
    } catch (e) {
      console.log(`WARN: could not read ${file}`);
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const escrow = extractJsonAfterMarker(line, saveMarker) as EscrowFromLog | null;
      if (escrow && escrow.account && escrow.sequence != null && typeof escrow.testnet === "boolean") {
        lastSeenEscrow = escrow;
        continue;
      }

      if (line.includes(errorMarker) && lastSeenEscrow) {
        failedByKey.set(escrowKey(lastSeenEscrow), lastSeenEscrow);
        // keep lastSeenEscrow as-is; subsequent error lines should map to same one until overwritten
      }
    }
  }

  let failed = Array.from(failedByKey.values());
  if (limit != null && !isNaN(limit)) failed = failed.slice(0, Math.max(0, limit));

  console.log(`Found ${failed.length} unique escrows with saveEscrow errors.`);
  if (failed.length === 0) process.exit(0);

  if (dryRun) {
    console.log("Dry-run mode (no inserts). Sample:");
    console.log(JSON.stringify(failed.slice(0, Math.min(10, failed.length)), null, 2));
    process.exit(0);
  }

  let inserted = 0;
  let already = 0;
  let errors = 0;

  for (const escrow of failed) {
    const key = escrowKey(escrow);
    try {
      const exists = await escrowExists(escrow);
      if (exists) {
        already++;
        continue;
      }

      const ok = await addEscrow(escrow);
      if (ok) inserted++;
      else {
        errors++;
        console.log(`ERROR: addEscrow returned success=false for ${key}`);
      }
    } catch (e: any) {
      errors++;
      console.log(`ERROR: ${key}: ${e?.message || String(e)}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        processed: failed.length,
        inserted,
        already_existed: already,
        errors,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.log(`Fatal error: ${e?.message || String(e)}`);
  process.exit(1);
});

