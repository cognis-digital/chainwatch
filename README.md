# chainwatch

**EVM event watcher with rule-based alerting.**

`chainwatch` lets you declare a set of watched contracts, the event signatures
you care about, and alert rules over decoded event fields. It then processes a
batch of logs and fires alerts when rules match. The chain provider is
abstracted behind an injectable interface, so the core runs **fully offline on
fixture logs** — a `--live` JSON-RPC path exists but is isolated and never used
in tests.

Analytical / monitoring scope only. No transaction signing, no on-chain
actions — chainwatch reads and evaluates, it never sends.

- **Maintainer:** Cognis Digital
- **License:** COCL 1.0
- **Package:** `@cognis-digital/chainwatch`
- **Runtime deps:** none (TypeScript + Node `node:test` only)

---


<!-- cognis:example:start -->
## 🔎 Example output

**Sample result format** _(illustrative values — run on your own data for real findings):_

```
{
  "chains": [
    {
      "id": "0x1234567890123456",
      "name": "Bitcoin",
      "block_height": 123456,
      "timestamp": "2022-07-12T14:30:00Z"
    },
    {
      "id": "0x2345678901234567",
      "name": "Ethereum",
      "block_height": 987654,
      "timestamp": "2022-06-15T10:45:00Z"
    }
  ]
}
```

<!-- cognis:example:end -->

## Install / build

```bash
npm install
npm run build      # tsc -> dist/
npm test           # builds then runs node:test over dist/test/
```

Requires Node.js >= 20.

## Quick start

```bash
# scaffold a starter config + matching fixture logs
node dist/src/cli.js new --config my.config.json --logs my.logs.json

# validate it
node dist/src/cli.js validate my.config.json

# scan the fixture logs and print matched alerts
node dist/src/cli.js scan my.config.json --logs my.logs.json
```

Or run against the shipped examples:

```bash
node dist/src/cli.js scan examples/config.json --logs examples/logs.json
```

## Commands

| Command | Purpose | Exit codes |
| --- | --- | --- |
| `validate <config.json>` | Check contracts/events/rules are well-formed | `0` valid, `1` invalid |
| `scan <config.json> --logs <fixture.json>` | Evaluate rules over decoded logs, print alerts | `0` ok, `1` config/IO error, `2` if `--fail-on-match` and alerts fired |
| `rules <config.json>` | List declared rules | `0` |
| `new` | Scaffold a starter config + fixtures | `0` |
| `help` | Show usage | `0` |

Flags: `--json` (machine-readable output, on `validate`/`scan`/`rules`),
`--fail-on-match` (CI gate on `scan`), `--config` / `--logs` / `--force`
(on `new`).

## Config format

```jsonc
{
  "name": "example-watcher",
  "chain": "ethereum",
  "contracts": [
    {
      "name": "USDC",
      "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "events": ["Transfer(address,address,uint256)"]
    }
  ],
  "rules": [
    {
      "id": "large-transfer",
      "description": "USDC transfer over 1,000,000 units",
      "severity": "warn",
      "contracts": ["USDC"],          // optional scope by contract name
      "events": ["Transfer"],          // optional scope by event name
      "when": [                        // all clauses must match (logical AND)
        { "field": "value", "op": "gt", "value": "1000000000000" }
      ]
    }
  ]
}
```

### Rule operators

| Operator | Meaning |
| --- | --- |
| `eq` | Equal. Numeric-aware (BigInt/decimal) first, then case-insensitive string compare. |
| `gt` | Greater than. BigInt for integers, float for decimals. |
| `lt` | Less than. Same numeric handling as `gt`. |
| `contains` | Case-insensitive substring match. |
| `from-address` | Address match against the named field, falling back to `args.from` then the emitting `address`. |

### Fields a clause can target

- Any decoded event argument by name (e.g. `value`, `from`, `to`, `spender`).
- Synthetic fields: `address` (emitting contract), `event` (event name),
  `blockNumber`, `transactionHash`, `topic0`.

Large integers (e.g. `uint256` amounts beyond `Number.MAX_SAFE_INTEGER`) are
compared exactly using `BigInt`, so `gt`/`lt`/`eq` on full-precision token
amounts are correct.

## Decoded log fixtures

`scan` reads a JSON array of decoded logs. Field-based matching means you do
not need an ABI decoder at runtime — supply the decoded fields directly:

```json
[
  {
    "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "event": "Transfer",
    "blockNumber": 19000000,
    "transactionHash": "0xabc",
    "logIndex": 0,
    "args": {
      "from": "0x1111111111111111111111111111111111111111",
      "to": "0x2222222222222222222222222222222222222222",
      "value": "5000000000000"
    }
  }
]
```

## Topic hashing (optional)

chainwatch ships an original, dependency-free **Keccak-256** implementation so
it can compute the canonical `topic0` of an event signature:

```ts
import { eventTopic } from "@cognis-digital/chainwatch";

eventTopic("Transfer(address,address,uint256)");
// 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
```

This is verified against known ERC-20 topic hashes in the test suite. Rule
matching itself works purely on decoded fields, so no crypto is required at
evaluation time.

## Live mode (isolated)

`LiveRpcProvider` queries `eth_getLogs` over JSON-RPC and is the path a real
deployment would inject. It performs network I/O and is **deliberately excluded
from the test suite** — chainwatch's core logic never depends on it. Point it
at your own endpoint:

```ts
import { LiveRpcProvider, scan, loadConfig } from "@cognis-digital/chainwatch";

const provider = new LiveRpcProvider({
  rpcUrl: process.env.RPC_URL!,
  addresses: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
  fromBlock: "latest",
  toBlock: "latest",
});
const cfg = await loadConfig("examples/config.json");
const logs = await provider.fetchLogs();
console.log(scan(cfg, logs));
```

## Library API

```ts
import {
  loadConfig, validateConfig,
  scan, evalRule, evalClause,
  FixtureProvider, MemoryProvider,
  eventTopic,
} from "@cognis-digital/chainwatch";
```

## Project layout

```
src/
  cli.ts        command-line entry point
  config.ts     load + validate config
  engine.ts     rule evaluation (scan/evalRule/evalClause)
  provider.ts   LogProvider interface + Fixture/Memory/LiveRpc providers
  keccak.ts     original Keccak-256 + eventTopic
  scaffold.ts   `chainwatch new` templates
  types.ts      shared type definitions
  index.ts      public library exports
test/           node:test suites + offline fixtures
examples/       runnable config.json + logs.json
```

## Development

```bash
npm run build    # compile TypeScript
npm test         # offline; no network access required
npm run clean    # remove dist/
```

CI builds and tests on Node 20 (Ubuntu) via `.github/workflows/ci.yml`.
