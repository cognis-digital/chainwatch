import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, eventTopic, eventName } from "../src/keccak.js";

test("keccak256 of empty input matches known Keccak-256 digest", () => {
  const out = toHex(keccak256(new Uint8Array(0)));
  assert.equal(
    out,
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
});

test("keccak256 of 'abc' matches known Keccak-256 digest", () => {
  const out = toHex(keccak256(new TextEncoder().encode("abc")));
  assert.equal(
    out,
    "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
  );
});

test("eventTopic of Transfer matches the canonical ERC-20 Transfer topic0", () => {
  assert.equal(
    eventTopic("Transfer(address,address,uint256)"),
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  );
});

test("eventTopic of Approval matches the canonical ERC-20 Approval topic0", () => {
  assert.equal(
    eventTopic("Approval(address,address,uint256)"),
    "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"
  );
});

test("eventTopic ignores whitespace inside the signature", () => {
  assert.equal(
    eventTopic("Transfer(address, address, uint256)"),
    eventTopic("Transfer(address,address,uint256)")
  );
});

test("eventName extracts the bare event name", () => {
  assert.equal(eventName("Transfer(address,address,uint256)"), "Transfer");
  assert.equal(eventName("Deposit(address,uint256)"), "Deposit");
  assert.equal(eventName("NoArgs"), "NoArgs");
});
