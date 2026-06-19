import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLogs } from "../src/provider.js";

test("parseLogs accepts a well-formed array", () => {
  const logs = parseLogs([
    { address: "0xabc", event: "Transfer", args: { value: "1" }, blockNumber: 5 },
  ]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].address, "0xabc");
  assert.equal(logs[0].blockNumber, 5);
  assert.deepEqual(logs[0].args, { value: "1" });
});

test("parseLogs defaults missing args to empty object", () => {
  const logs = parseLogs([{ address: "0xabc", event: "X" }]);
  assert.deepEqual(logs[0].args, {});
});

test("parseLogs rejects a non-array", () => {
  assert.throws(() => parseLogs({}), /must be a JSON array/);
});

test("parseLogs rejects entries missing address/event", () => {
  assert.throws(() => parseLogs([{ event: "X" }]), /address must be a string/);
  assert.throws(() => parseLogs([{ address: "0x" }]), /event must be a string/);
});
