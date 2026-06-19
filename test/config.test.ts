import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, validateConfig } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureConfig = join(here, "fixtures", "config.json");

test("valid fixture config passes validation", async () => {
  const cfg = await loadConfig(fixtureConfig);
  const res = validateConfig(cfg);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.errors.length, 0);
});

test("non-object root is rejected", () => {
  assert.equal(validateConfig(42).ok, false);
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig([]).ok, false);
});

test("missing contracts/rules arrays are errors", () => {
  const res = validateConfig({});
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("contracts")));
  assert.ok(res.errors.some((e) => e.includes("rules")));
});

test("bad address is rejected", () => {
  const res = validateConfig({
    contracts: [{ name: "X", address: "0x123", events: ["Transfer(address,address,uint256)"] }],
    rules: [{ id: "r", when: [{ field: "value", op: "gt", value: "1" }] }],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("address")));
});

test("invalid event signature is rejected", () => {
  const res = validateConfig({
    contracts: [{ name: "X", address: "0x" + "a".repeat(40), events: ["not a sig"] }],
    rules: [{ id: "r", when: [{ field: "value", op: "gt", value: "1" }] }],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("event signature")));
});

test("duplicate contract name and rule id are errors", () => {
  const addr = "0x" + "a".repeat(40);
  const res = validateConfig({
    contracts: [
      { name: "X", address: addr, events: ["Transfer(address,address,uint256)"] },
      { name: "X", address: addr, events: ["Transfer(address,address,uint256)"] },
    ],
    rules: [
      { id: "dup", when: [{ field: "value", op: "eq", value: "1" }] },
      { id: "dup", when: [{ field: "value", op: "eq", value: "1" }] },
    ],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("duplicated")));
});

test("unknown operator is rejected", () => {
  const res = validateConfig({
    contracts: [{ name: "X", address: "0x" + "a".repeat(40), events: ["Transfer(address,address,uint256)"] }],
    rules: [{ id: "r", when: [{ field: "value", op: "between", value: "1" }] }],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("op must be one of")));
});

test("gt/lt require numeric value", () => {
  const res = validateConfig({
    contracts: [{ name: "X", address: "0x" + "a".repeat(40), events: ["Transfer(address,address,uint256)"] }],
    rules: [{ id: "r", when: [{ field: "value", op: "gt", value: "abc" }] }],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("must be numeric")));
});

test("from-address requires a 0x address value", () => {
  const res = validateConfig({
    contracts: [{ name: "X", address: "0x" + "a".repeat(40), events: ["Transfer(address,address,uint256)"] }],
    rules: [{ id: "r", when: [{ field: "from", op: "from-address", value: "nope" }] }],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("0x address")));
});

test("rule referencing unknown contract is an error", () => {
  const res = validateConfig({
    contracts: [{ name: "X", address: "0x" + "a".repeat(40), events: ["Transfer(address,address,uint256)"] }],
    rules: [{ id: "r", contracts: ["NOPE"], when: [{ field: "value", op: "eq", value: "1" }] }],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("does not match any declared contract")));
});

test("empty contracts/rules produce warnings not errors", () => {
  const res = validateConfig({ contracts: [], rules: [] });
  assert.equal(res.ok, true);
  assert.ok(res.warnings.length >= 2);
});
