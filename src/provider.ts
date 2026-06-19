/**
 * Chain provider abstraction.
 *
 * chainwatch never talks to a network in its core logic. A `LogProvider`
 * supplies decoded logs; tests inject a FixtureProvider that reads from a
 * JSON file, while a live deployment would inject a provider backed by a
 * JSON-RPC endpoint. The live provider here is intentionally isolated and is
 * never exercised by the test suite.
 */

import { readFile } from "node:fs/promises";
import type { DecodedLog } from "./types.js";

/** Source of decoded logs for a scan. */
export interface LogProvider {
  /** A short label for diagnostics. */
  readonly label: string;
  /** Return a batch of decoded logs to evaluate. */
  fetchLogs(): Promise<DecodedLog[]>;
}

/** Validate that a parsed fixture is an array of plausible DecodedLogs. */
export function parseLogs(parsed: unknown): DecodedLog[] {
  if (!Array.isArray(parsed)) {
    throw new Error("logs fixture must be a JSON array of decoded logs");
  }
  return parsed.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`logs[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.address !== "string") {
      throw new Error(`logs[${i}].address must be a string`);
    }
    if (typeof e.event !== "string") {
      throw new Error(`logs[${i}].event must be a string`);
    }
    const args =
      e.args && typeof e.args === "object" && !Array.isArray(e.args)
        ? (e.args as Record<string, string | number>)
        : {};
    return {
      address: e.address,
      event: e.event,
      args,
      blockNumber:
        typeof e.blockNumber === "number" ? e.blockNumber : undefined,
      transactionHash:
        typeof e.transactionHash === "string" ? e.transactionHash : undefined,
      logIndex: typeof e.logIndex === "number" ? e.logIndex : undefined,
      topic0: typeof e.topic0 === "string" ? e.topic0 : undefined,
    } satisfies DecodedLog;
  });
}

/** A provider that reads decoded logs from a fixture JSON file. */
export class FixtureProvider implements LogProvider {
  readonly label: string;
  constructor(private readonly path: string) {
    this.label = `fixture:${path}`;
  }

  async fetchLogs(): Promise<DecodedLog[]> {
    const raw = await readFile(this.path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `logs ${this.path} is not valid JSON: ${(err as Error).message}`
      );
    }
    return parseLogs(parsed);
  }
}

/** A provider backed by in-memory logs (useful for tests/embedding). */
export class MemoryProvider implements LogProvider {
  readonly label = "memory";
  constructor(private readonly logs: DecodedLog[]) {}
  async fetchLogs(): Promise<DecodedLog[]> {
    return this.logs;
  }
}

/**
 * Options for the live JSON-RPC provider.
 *
 * NOTE: This path performs network I/O and is deliberately excluded from the
 * test suite. It is only constructed when `chainwatch scan --live` is used.
 */
export interface LiveProviderOptions {
  rpcUrl: string;
  addresses: string[];
  fromBlock: number | "latest";
  toBlock: number | "latest";
  /** Optional fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * A live provider that queries `eth_getLogs` over JSON-RPC. Raw logs are
 * returned in a minimally-decoded form (topic0 preserved; args left empty
 * unless the caller supplies an ABI decoder later). Kept intentionally small
 * and isolated — chainwatch's core never depends on it.
 */
export class LiveRpcProvider implements LogProvider {
  readonly label: string;
  constructor(private readonly opts: LiveProviderOptions) {
    this.label = `live:${opts.rpcUrl}`;
  }

  async fetchLogs(): Promise<DecodedLog[]> {
    const f = this.opts.fetchImpl ?? fetch;
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [
        {
          address: this.opts.addresses,
          fromBlock: toBlockTag(this.opts.fromBlock),
          toBlock: toBlockTag(this.opts.toBlock),
        },
      ],
    };
    const res = await f(this.opts.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`RPC error: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (json.error) {
      throw new Error(`RPC error: ${json.error.message ?? "unknown"}`);
    }
    const result = Array.isArray(json.result) ? json.result : [];
    return result.map((raw) => {
      const r = raw as Record<string, unknown>;
      const topics = Array.isArray(r.topics) ? (r.topics as string[]) : [];
      return {
        address: String(r.address ?? ""),
        // Without an ABI we cannot name the event; surface topic0 as the event
        // and leave decoded args empty. Field-based rules on `topic0`/`address`
        // still work; richer decoding is a future enhancement.
        event: topics[0] ?? "unknown",
        args: {},
        blockNumber:
          typeof r.blockNumber === "string"
            ? Number(BigInt(r.blockNumber))
            : undefined,
        transactionHash:
          typeof r.transactionHash === "string"
            ? r.transactionHash
            : undefined,
        logIndex:
          typeof r.logIndex === "string"
            ? Number(BigInt(r.logIndex))
            : undefined,
        topic0: topics[0],
      } satisfies DecodedLog;
    });
  }
}

function toBlockTag(b: number | "latest"): string {
  return b === "latest" ? "latest" : "0x" + b.toString(16);
}
