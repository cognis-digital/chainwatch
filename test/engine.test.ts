import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/config.js";
import { scan, evalClause } from "../src/engine.js";
import { FixtureProvider, MemoryProvider } from "../src/provider.js";
import type { ChainwatchConfig, DecodedLog } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureConfig = join(here, "fixtures", "config.json");
const fixtureLogs = join(here, "fixtures", "logs.json");

async function loadFixtureCfg(): Promise<ChainwatchConfig> {
  return (await loadConfig(fixtureConfig)) as ChainwatchConfig;
}

test("scan over fixtures fires expected alerts", async () => {
  const cfg = await loadFixtureCfg();
  const logs = await new FixtureProvider(fixtureLogs).fetchLogs();
  const res = scan(cfg, logs);

  assert.equal(res.logsProcessed, 4);
  // one log is from an unwatched address
  assert.equal(res.unattributed, 1);

  const ids = res.alerts.map((a) => a.ruleId).sort();
  // log0: value 5000 -> big-transfer; from flagged -> from-flagged
  // log2: event Approval -> exact-event
  // log3: unattributed address but from-flagged has no contract scope; from is not flagged -> no match
  assert.deepEqual(ids, ["big-transfer", "exact-event", "from-flagged"]);
});

test("BigInt comparison handles values beyond Number.MAX_SAFE_INTEGER", () => {
  const log: DecodedLog = {
    address: "0xabc",
    event: "Approval",
    args: {
      value:
        "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    },
  };
  assert.equal(
    evalClause(log, { field: "value", op: "gt", value: "1000000000000000000000000" }),
    true
  );
  assert.equal(
    evalClause(log, { field: "value", op: "lt", value: "1" }),
    false
  );
});

test("eq is numeric-aware then case-insensitive string fallback", () => {
  const log: DecodedLog = {
    address: "0xABCDEF",
    event: "Transfer",
    args: { value: "100", to: "0xDeAdBeEf" },
  };
  assert.equal(evalClause(log, { field: "value", op: "eq", value: 100 }), true);
  assert.equal(evalClause(log, { field: "value", op: "eq", value: "0x64" }), true);
  assert.equal(evalClause(log, { field: "to", op: "eq", value: "0xdeadbeef" }), true);
  assert.equal(evalClause(log, { field: "event", op: "eq", value: "transfer" }), true);
  assert.equal(evalClause(log, { field: "event", op: "eq", value: "Approval" }), false);
});

test("contains matches substrings case-insensitively", () => {
  const log: DecodedLog = {
    address: "0xabc",
    event: "Approval",
    args: { spender: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" },
  };
  assert.equal(evalClause(log, { field: "spender", op: "contains", value: "0x7A25" }), true);
  assert.equal(evalClause(log, { field: "spender", op: "contains", value: "0000" }), false);
});

test("from-address falls back to args.from when field is synthetic", () => {
  const log: DecodedLog = {
    address: "0xcontract",
    event: "Transfer",
    args: { from: "0x1111111111111111111111111111111111111111" },
  };
  assert.equal(
    evalClause(log, {
      field: "from",
      op: "from-address",
      value: "0x1111111111111111111111111111111111111111",
    }),
    true
  );
});

test("missing field never matches gt/lt/contains/eq", () => {
  const log: DecodedLog = { address: "0xabc", event: "X", args: {} };
  assert.equal(evalClause(log, { field: "ghost", op: "gt", value: "1" }), false);
  assert.equal(evalClause(log, { field: "ghost", op: "lt", value: "1" }), false);
  assert.equal(evalClause(log, { field: "ghost", op: "eq", value: "1" }), false);
  assert.equal(evalClause(log, { field: "ghost", op: "contains", value: "1" }), false);
});

test("rule with multiple clauses requires all (AND)", () => {
  const cfg: ChainwatchConfig = {
    contracts: [
      { name: "C", address: "0x" + "a".repeat(40), events: ["Transfer(address,address,uint256)"] },
    ],
    rules: [
      {
        id: "and-rule",
        when: [
          { field: "value", op: "gt", value: "100" },
          { field: "to", op: "eq", value: "0xtarget" },
        ],
      },
    ],
  };
  const logs: DecodedLog[] = [
    { address: "0x" + "a".repeat(40), event: "Transfer", args: { value: "200", to: "0xtarget" } },
    { address: "0x" + "a".repeat(40), event: "Transfer", args: { value: "200", to: "0xother" } },
    { address: "0x" + "a".repeat(40), event: "Transfer", args: { value: "5", to: "0xtarget" } },
  ];
  const res = scan(cfg, logs);
  assert.equal(res.alerts.length, 1);
  assert.equal(res.alerts[0].matched.length, 2);
});

test("contract/event scoping filters rule evaluation", async () => {
  const cfg = await loadFixtureCfg();
  // big-transfer is scoped to contract TKN + event Transfer.
  // Feed a Transfer with big value from a DIFFERENT (unwatched) address.
  const logs: DecodedLog[] = [
    { address: "0xUNWATCHED", event: "Transfer", args: { from: "0x0", to: "0x0", value: "99999" } },
  ];
  const res = scan(cfg, logs);
  // big-transfer must NOT fire (wrong contract); from-flagged must NOT fire (from not flagged).
  assert.equal(res.alerts.length, 0);
});

test("MemoryProvider yields the same scan result as fixture file", async () => {
  const cfg = await loadFixtureCfg();
  const logs = await new FixtureProvider(fixtureLogs).fetchLogs();
  const mem = await new MemoryProvider(logs).fetchLogs();
  assert.deepEqual(scan(cfg, mem).alerts.map((a) => a.ruleId), scan(cfg, logs).alerts.map((a) => a.ruleId));
});
