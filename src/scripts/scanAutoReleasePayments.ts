import { Client, convertHexToString, convertStringToHex } from "xrpl";
import { Xumm } from "../xumm";
import { DB } from "../db";

type ParsedPayment = {
  txid?: string;
  ledgerIndex?: number;
  dateIso?: string;
  payer?: string;
  owner: string;
  sequence: number;
  memo: string;
};

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const out: {
    destination: string;
    ws: string;
    sinceIso: string;
    limitPerRequest: number;
    maxRequests?: number;
    refundPayloads: boolean;
    origin: string;
    refundFromAccount: string;
    refundAmountDropsPerFee: string;
  } = {
    destination: "rNixerUVPwrhxGDt4UooDu6FJ7zuofvjCF",
    ws: process.env.XRPL_WS_MAINNET || "wss://xrplcluster.com",
    sinceIso: "2026-02-01T00:00:00.000Z",
    limitPerRequest: 200,
    refundPayloads: false,
    origin: "https://xrpl.services",
    refundFromAccount: "rNixerUVPwrhxGDt4UooDu6FJ7zuofvjCF",
    refundAmountDropsPerFee: "1000000",
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--destination") out.destination = args[++i];
    else if (a === "--ws") out.ws = args[++i];
    else if (a === "--since") out.sinceIso = args[++i];
    else if (a === "--limit") out.limitPerRequest = parseInt(args[++i] || "", 10) || out.limitPerRequest;
    else if (a === "--maxRequests") out.maxRequests = parseInt(args[++i] || "", 10);
    else if (a === "--refundPayloads") out.refundPayloads = true;
    else if (a === "--origin") out.origin = args[++i];
    else if (a === "--refundFrom") out.refundFromAccount = args[++i];
    else if (a === "--feeDrops") out.refundAmountDropsPerFee = args[++i];
  }

  return out;
}

function rippleTimeToDateIso(rippleTime?: number): string | undefined {
  if (typeof rippleTime !== "number") return undefined;
  // Ripple epoch starts 2000-01-01T00:00:00Z
  const unixSeconds = rippleTime + 946684800;
  return new Date(unixSeconds * 1000).toISOString();
}

function getMemoStrings(tx: any): string[] {
  const memos = tx?.Memos;
  if (!Array.isArray(memos)) return [];

  const out: string[] = [];
  for (const m of memos) {
    const memo = m?.Memo;
    if (!memo) continue;

    const parts: string[] = [];
    for (const k of ["MemoType", "MemoFormat", "MemoData"] as const) {
      if (typeof memo[k] === "string" && memo[k].length > 0) {
        try {
          parts.push(convertHexToString(memo[k]));
        } catch {
          // ignore invalid hex
        }
      }
    }

    if (parts.length > 0) out.push(parts.join(" "));
  }

  return out;
}

function parseOwnerAndSequence(memo: string): { owner: string; sequence: number } | null {
  // Example:
  // "Payment for Auto Release of Escrow via xApp! Owner:r... Sequence: 98469506"
  const ownerMatch = memo.match(/Owner\s*:\s*(r[1-9A-HJ-NP-Za-km-z]{24,34})/i);
  const seqMatch = memo.match(/Sequence\s*:\s*(\d+)/i);
  if (!ownerMatch || !seqMatch) return null;

  const owner = ownerMatch[1];
  const sequence = parseInt(seqMatch[1], 10);
  if (!owner || !Number.isFinite(sequence)) return null;

  return { owner, sequence };
}

function isOneXrpInboundPayment(tx: any, destination: string): boolean {
  if (!tx || tx.TransactionType !== "Payment") return false;
  if (tx.Destination !== destination) return false;
  // Only XRP: Amount is a string in drops
  if (typeof tx.Amount !== "string") return false;
  return tx.Amount === "1000000";
}

function refundMemoMessage(refundCountXrp: number) {
  if (refundCountXrp === 1) {
    return "1 XRP refund for duplicate Escrow Releaser Service fee paymet. Your Escow has been added and will be processed automatically.";
  }

  return `${refundCountXrp} XRP refund for duplicate Escrow Releaser Service fee paymet. Your Escow has been added and will be processed automatically.`;
}

async function createRefundPayloadsForDuplicates(params: {
  origin: string;
  refundFromAccount: string;
  duplicates: Record<string, ParsedPayment[]>;
  feeDropsPerPayment: string;
}) {
  const { origin, refundFromAccount, duplicates, feeDropsPerPayment } = params;

  const db = new DB();
  await db.initDb("scanAutoReleasePayments_refunds");

  const xumm = new Xumm();
  await xumm.init();

  const appId = await db.getAppIdForOrigin(origin);
  if (!appId || appId.trim().length === 0) {
    throw new Error(`Could not resolve application id for origin=${origin}`);
  }

  const xummUserToken = await db.getXummIdForXRPLAccount(appId, refundFromAccount);
  if (!xummUserToken || xummUserToken.trim().length === 0) {
    throw new Error(
      `Could not resolve Xumm user token for refundFromAccount=${refundFromAccount}. Ensure DB has mapping for origin=${origin}.`,
    );
  }

  const results: any[] = [];

  for (const [key, arr] of Object.entries(duplicates)) {
    // duplicates key is owner:sequence; payer is tx.Account
    const refundCount = Math.max(0, arr.length - 1);
    if (refundCount === 0) continue;

    const payer = arr[0]?.payer;
    if (!payer) {
      results.push({ key, success: false, error: "missing payer in parsed tx" });
      continue;
    }

    const amountDrops = String(BigInt(feeDropsPerPayment) * BigInt(refundCount));
    const memo = refundMemoMessage(refundCount);

    const payload: any = {
      user_token: xummUserToken,
      options: {
        expire: 10,
      },
      txjson: {
        TransactionType: "Payment",
        Destination: payer,
        Amount: amountDrops,
        Memos: [
          {
            Memo: {
              MemoData: convertStringToHex(memo),
            },
          },
        ],
      },
      custom_meta: {
        instruction: "Refund duplicate escrow releaser fee",
        blob: {
          duplicateKey: key,
          refundCountXrp: refundCount,
          refundDrops: amountDrops,
        },
      },
    };

    // Call Xumm directly (no origin/referer needed for scripting)
    const created = await xumm.callXumm(appId, "payload", "POST", payload, "scanAutoReleasePayments_refund");
    results.push({ key, payer, refundCountXrp: refundCount, amountDrops, payloadUuid: created?.uuid || null });
  }

  return results;
}

async function main() {
  const { destination, ws, sinceIso, limitPerRequest, maxRequests, refundPayloads, origin, refundFromAccount, refundAmountDropsPerFee } =
    parseArgs(process.argv);
  const sinceMs = Date.parse(sinceIso);

  if (!Number.isFinite(sinceMs)) {
    console.log("ERROR: invalid --since ISO date. Example: 2026-02-01T00:00:00.000Z");
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        ws,
        destination,
        since: new Date(sinceMs).toISOString(),
        limitPerRequest,
        maxRequests: maxRequests ?? null,
        refundPayloads,
        origin,
        refundFromAccount,
        feeDropsPerPayment: refundAmountDropsPerFee,
      },
      null,
      2,
    ),
  );

  const client = new Client(ws);
  await client.connect();

  const parsed: ParsedPayment[] = [];
  const seen = new Map<string, ParsedPayment[]>();

  let marker: any = undefined;
  let requestCount = 0;
  let stop = false;

  try {
    while (!stop) {
      if (maxRequests != null && requestCount >= maxRequests) break;
      requestCount++;

      const req: any = {
        command: "account_tx",
        account: destination,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: limitPerRequest,
        forward: false,
      };
      if (marker) req.marker = marker;

      const res: any = await client.request(req);
      const txs: any[] = res?.result?.transactions || [];
      marker = res?.result?.marker;

      if (txs.length === 0) break;

      for (const entry of txs) {
        const tx = entry?.tx;
        if (!tx) continue;

        const dateIso = rippleTimeToDateIso(tx.date);
        const txMs = dateIso ? Date.parse(dateIso) : undefined;
        if (txMs != null && Number.isFinite(txMs) && txMs < sinceMs) {
          stop = true;
          break;
        }

        if (!isOneXrpInboundPayment(tx, destination)) continue;

        const memoStrings = getMemoStrings(tx);
        if (memoStrings.length === 0) continue;

        for (const memo of memoStrings) {
          if (!memo.toLowerCase().includes("payment for auto release of escrow")) continue;

          const parsedInfo = parseOwnerAndSequence(memo);
          if (!parsedInfo) continue;

          const p: ParsedPayment = {
            txid: tx.hash,
            ledgerIndex: tx.ledger_index,
            dateIso,
            payer: tx.Account,
            owner: parsedInfo.owner,
            sequence: parsedInfo.sequence,
            memo,
          };

          parsed.push(p);
          const key = `${p.owner}:${p.sequence}`;
          const arr = seen.get(key) || [];
          arr.push(p);
          seen.set(key, arr);
        }
      }

      if (!marker) break;
    }
  } finally {
    await client.disconnect();
  }

  const duplicates: Record<string, ParsedPayment[]> = {};
  for (const [k, arr] of seen.entries()) {
    if (arr.length > 1) duplicates[k] = arr;
  }

  let refundPayloadResults: any[] | null = null;
  if (refundPayloads) {
    refundPayloadResults = await createRefundPayloadsForDuplicates({
      origin,
      refundFromAccount,
      duplicates,
      feeDropsPerPayment: refundAmountDropsPerFee,
    });
  }

  console.log(
    JSON.stringify(
      {
        scanned_requests: requestCount,
        parsed_payments: parsed.length,
        unique_owner_sequence: seen.size,
        duplicate_owner_sequence: Object.keys(duplicates).length,
        duplicates,
        refund_payloads_created: refundPayloadResults,
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

