#!/usr/bin/env node
/**
 * chainwatch CLI.
 *
 * Subcommands:
 *   validate <config.json>             structural + semantic config check
 *   scan <config.json> --logs <f.json> evaluate rules over fixture logs
 *   rules <config.json>                list declared rules
 *   new [--config p] [--logs p]        scaffold a starter config + fixtures
 *
 * The CLI is a thin wrapper around the library API; all logic lives in the
 * engine/config/provider modules so it stays unit-testable offline.
 */

import { loadConfig, validateConfig } from "./config.js";
import { scan } from "./engine.js";
import { FixtureProvider } from "./provider.js";
import { scaffold } from "./scaffold.js";
import type { Alert, ChainwatchConfig } from "./types.js";

const USAGE = `chainwatch — EVM event watcher with rule-based alerting

Usage:
  chainwatch validate <config.json>
  chainwatch scan <config.json> --logs <fixture.json> [--json] [--fail-on-match]
  chainwatch rules <config.json> [--json]
  chainwatch new [--config <path>] [--logs <path>] [--force]
  chainwatch help

Options:
  --logs <path>     fixture file of decoded logs (required for scan)
  --json            machine-readable JSON output
  --fail-on-match   exit non-zero if any alert fires (CI gate)
  --config <path>   output path for 'new' (default ./chainwatch.config.json)
  --force           overwrite existing files in 'new'

License: COCL 1.0   Maintainer: Cognis Digital`;

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

async function cmdValidate(args: ParsedArgs): Promise<number> {
  const path = args.positionals[0];
  if (!path) fail("validate requires <config.json>");
  let cfg: unknown;
  try {
    cfg = await loadConfig(path);
  } catch (err) {
    if (args.flags.json) {
      process.stdout.write(
        JSON.stringify({ ok: false, errors: [(err as Error).message], warnings: [] }, null, 2) + "\n"
      );
    } else {
      process.stderr.write(`error: ${(err as Error).message}\n`);
    }
    return 1;
  }
  const result = validateConfig(cfg);
  if (args.flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.ok) {
      process.stdout.write(`OK: config is valid (${path})\n`);
    } else {
      process.stdout.write(`INVALID: ${path}\n`);
    }
    for (const e of result.errors) process.stdout.write(`  error:   ${e}\n`);
    for (const w of result.warnings) process.stdout.write(`  warning: ${w}\n`);
  }
  return result.ok ? 0 : 1;
}

function formatAlert(a: Alert): string {
  const loc =
    a.log.blockNumber !== undefined
      ? ` block=${a.log.blockNumber}${
          a.log.logIndex !== undefined ? `#${a.log.logIndex}` : ""
        }`
      : "";
  const clauses = a.matched
    .map((m) => `${m.field} ${m.op} ${m.value} (actual=${m.actual ?? "∅"})`)
    .join(", ");
  return (
    `[${a.severity.toUpperCase()}] ${a.ruleId}` +
    `${a.description ? ` — ${a.description}` : ""}\n` +
    `    contract=${a.contractName ?? "(unwatched)"} event=${a.log.event} addr=${a.log.address}${loc}\n` +
    `    matched: ${clauses}`
  );
}

async function cmdScan(args: ParsedArgs): Promise<number> {
  const path = args.positionals[0];
  if (!path) fail("scan requires <config.json>");
  const logsPath = args.flags.logs;
  if (typeof logsPath !== "string") {
    fail("scan requires --logs <fixture.json>");
  }

  let cfg: ChainwatchConfig;
  try {
    cfg = await loadConfig(path);
  } catch (err) {
    return fail((err as Error).message);
  }
  const validation = validateConfig(cfg);
  if (!validation.ok) {
    process.stderr.write(`error: config invalid — run 'chainwatch validate ${path}'\n`);
    for (const e of validation.errors) process.stderr.write(`  ${e}\n`);
    return 1;
  }

  const provider = new FixtureProvider(logsPath as string);
  let logs;
  try {
    logs = await provider.fetchLogs();
  } catch (err) {
    return fail((err as Error).message);
  }

  const result = scan(cfg, logs);

  if (args.flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          logsProcessed: result.logsProcessed,
          unattributed: result.unattributed,
          alertCount: result.alerts.length,
          alerts: result.alerts,
        },
        null,
        2
      ) + "\n"
    );
  } else {
    process.stdout.write(
      `Scanned ${result.logsProcessed} log(s) from ${provider.label}; ` +
        `${result.alerts.length} alert(s), ${result.unattributed} unattributed.\n`
    );
    if (result.alerts.length === 0) {
      process.stdout.write("No alerts fired.\n");
    } else {
      process.stdout.write("\n");
      for (const a of result.alerts) {
        process.stdout.write(formatAlert(a) + "\n\n");
      }
    }
  }

  if (args.flags["fail-on-match"] && result.alerts.length > 0) {
    return 2;
  }
  return 0;
}

async function cmdRules(args: ParsedArgs): Promise<number> {
  const path = args.positionals[0];
  if (!path) fail("rules requires <config.json>");
  let cfg: ChainwatchConfig;
  try {
    cfg = await loadConfig(path);
  } catch (err) {
    return fail((err as Error).message);
  }

  if (args.flags.json) {
    process.stdout.write(JSON.stringify(cfg.rules ?? [], null, 2) + "\n");
    return 0;
  }

  const rules = cfg.rules ?? [];
  if (rules.length === 0) {
    process.stdout.write("No rules declared.\n");
    return 0;
  }
  process.stdout.write(`${rules.length} rule(s) in ${path}:\n\n`);
  for (const r of rules) {
    const scopeBits: string[] = [];
    if (r.contracts && r.contracts.length) scopeBits.push(`contracts=[${r.contracts.join(",")}]`);
    if (r.events && r.events.length) scopeBits.push(`events=[${r.events.join(",")}]`);
    const scope = scopeBits.length ? ` (${scopeBits.join(" ")})` : "";
    process.stdout.write(
      `  ${r.id}  [${r.severity ?? "info"}]${scope}\n`
    );
    if (r.description) process.stdout.write(`      ${r.description}\n`);
    for (const c of r.when ?? []) {
      process.stdout.write(`      when ${c.field} ${c.op} ${c.value}\n`);
    }
  }
  return 0;
}

async function cmdNew(args: ParsedArgs): Promise<number> {
  const configPath =
    typeof args.flags.config === "string"
      ? args.flags.config
      : "chainwatch.config.json";
  const logsPath =
    typeof args.flags.logs === "string" ? args.flags.logs : "chainwatch.logs.json";
  const force = Boolean(args.flags.force);

  const res = await scaffold(configPath, logsPath, force);
  for (const w of res.written) process.stdout.write(`created ${w}\n`);
  for (const s of res.skipped)
    process.stdout.write(`skipped ${s} (exists; use --force)\n`);
  process.stdout.write(
    `\nNext: chainwatch scan ${configPath} --logs ${logsPath}\n`
  );
  return 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  let code = 0;
  switch (cmd) {
    case "validate":
      code = await cmdValidate(args);
      break;
    case "scan":
      code = await cmdScan(args);
      break;
    case "rules":
      code = await cmdRules(args);
      break;
    case "new":
      code = await cmdNew(args);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE + "\n");
      code = cmd === undefined ? 1 : 0;
      break;
    default:
      process.stderr.write(`error: unknown command "${cmd}"\n\n${USAGE}\n`);
      code = 1;
  }
  process.exit(code);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
