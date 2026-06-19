/**
 * Scaffolding for `chainwatch new`.
 *
 * Writes a starter config + matching fixture logs so a user can run
 * `chainwatch scan` immediately and see an alert fire.
 */

import { writeFile, mkdir, access } from "node:fs/promises";
import { dirname } from "node:path";

export const SCAFFOLD_CONFIG = {
  name: "my-watcher",
  chain: "ethereum",
  contracts: [
    {
      name: "USDC",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      events: ["Transfer(address,address,uint256)"],
    },
  ],
  rules: [
    {
      id: "large-transfer",
      description: "USDC transfer over 1,000,000 (6-decimal) units",
      severity: "warn",
      contracts: ["USDC"],
      events: ["Transfer"],
      when: [{ field: "value", op: "gt", value: "1000000000000" }],
    },
    {
      id: "watched-sender",
      description: "Any event originating from a watched address",
      severity: "info",
      when: [
        {
          field: "from",
          op: "from-address",
          value: "0x1111111111111111111111111111111111111111",
        },
      ],
    },
  ],
};

export const SCAFFOLD_LOGS = [
  {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    event: "Transfer",
    blockNumber: 19000000,
    transactionHash: "0xabc123",
    logIndex: 0,
    args: {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "5000000000000",
    },
  },
  {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    event: "Transfer",
    blockNumber: 19000001,
    transactionHash: "0xdef456",
    logIndex: 1,
    args: {
      from: "0x3333333333333333333333333333333333333333",
      to: "0x4444444444444444444444444444444444444444",
      value: "100",
    },
  },
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface ScaffoldResult {
  written: string[];
  skipped: string[];
}

/**
 * Write scaffold files. Existing files are skipped (never overwritten) unless
 * `force` is set.
 */
export async function scaffold(
  configPath: string,
  logsPath: string,
  force = false
): Promise<ScaffoldResult> {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const [path, data] of [
    [configPath, SCAFFOLD_CONFIG],
    [logsPath, SCAFFOLD_LOGS],
  ] as const) {
    if (!force && (await exists(path))) {
      skipped.push(path);
      continue;
    }
    const dir = dirname(path);
    if (dir && dir !== ".") await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
    written.push(path);
  }

  return { written, skipped };
}
