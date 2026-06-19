/**
 * Rule evaluation engine for chainwatch.
 *
 * Given a validated config and a batch of decoded logs, the engine attributes
 * each log to a watched contract (by address), then evaluates every applicable
 * rule. A rule fires when all of its clauses match (logical AND).
 */

import type {
  Alert,
  ChainwatchConfig,
  ContractDef,
  DecodedLog,
  Operator,
  RuleClause,
  RuleDef,
} from "./types.js";

/** Index for fast address -> contract lookup (addresses lowercased). */
export class ContractIndex {
  private byAddress = new Map<string, ContractDef>();
  private byName = new Map<string, ContractDef>();

  constructor(contracts: ContractDef[]) {
    for (const c of contracts) {
      this.byAddress.set(c.address.toLowerCase(), c);
      this.byName.set(c.name, c);
    }
  }

  forAddress(addr: string): ContractDef | undefined {
    return this.byAddress.get(addr.toLowerCase());
  }

  forName(name: string): ContractDef | undefined {
    return this.byName.get(name);
  }
}

/** Resolve the value of a clause field against a decoded log. */
function fieldValue(log: DecodedLog, field: string): string | number | undefined {
  switch (field) {
    case "address":
      return log.address;
    case "event":
      return log.event;
    case "blockNumber":
      return log.blockNumber;
    case "transactionHash":
      return log.transactionHash;
    case "topic0":
      return log.topic0;
    default:
      return log.args[field];
  }
}

/**
 * Try to interpret a value as a BigInt for exact integer comparison.
 * Returns null if it isn't a clean integer (decimals, hex non-integers, etc).
 */
function asBigInt(v: string | number | undefined): bigint | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") {
    return Number.isInteger(v) ? BigInt(v) : null;
  }
  const t = v.trim();
  if (/^-?\d+$/.test(t)) {
    try {
      return BigInt(t);
    } catch {
      return null;
    }
  }
  if (/^0x[0-9a-fA-F]+$/.test(t)) {
    try {
      return BigInt(t);
    } catch {
      return null;
    }
  }
  return null;
}

/** Try to interpret a value as a finite float for decimal comparison. */
function asFloat(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Evaluate a single clause against a log. Returns whether it matches. */
export function evalClause(log: DecodedLog, clause: RuleClause): boolean {
  const actual = fieldValue(log, clause.field);
  return applyOperator(clause.op, actual, clause.value, log);
}

function applyOperator(
  op: Operator,
  actual: string | number | undefined,
  expected: string | number,
  log: DecodedLog
): boolean {
  switch (op) {
    case "eq": {
      if (actual === undefined) return false;
      // Numeric-aware equality first, then string fallback (case-insensitive).
      const ab = asBigInt(actual);
      const eb = asBigInt(expected);
      if (ab !== null && eb !== null) return ab === eb;
      return String(actual).toLowerCase() === String(expected).toLowerCase();
    }
    case "gt": {
      const ab = asBigInt(actual);
      const eb = asBigInt(expected);
      if (ab !== null && eb !== null) return ab > eb;
      const af = asFloat(actual);
      const ef = asFloat(expected);
      if (af !== null && ef !== null) return af > ef;
      return false;
    }
    case "lt": {
      const ab = asBigInt(actual);
      const eb = asBigInt(expected);
      if (ab !== null && eb !== null) return ab < eb;
      const af = asFloat(actual);
      const ef = asFloat(expected);
      if (af !== null && ef !== null) return af < ef;
      return false;
    }
    case "contains": {
      if (actual === undefined) return false;
      return String(actual)
        .toLowerCase()
        .includes(String(expected).toLowerCase());
    }
    case "from-address": {
      // Match against the conventional "from" arg, falling back to the named
      // field if the clause targeted a specific one.
      const candidate =
        actual !== undefined ? actual : log.args["from"] ?? log.address;
      if (candidate === undefined) return false;
      return (
        String(candidate).toLowerCase() === String(expected).toLowerCase()
      );
    }
    default:
      return false;
  }
}

/** Does this rule apply to this (already attributed) log? */
function ruleApplies(
  rule: RuleDef,
  log: DecodedLog,
  contractName: string | null
): boolean {
  if (rule.contracts && rule.contracts.length > 0) {
    if (contractName === null || !rule.contracts.includes(contractName)) {
      return false;
    }
  }
  if (rule.events && rule.events.length > 0) {
    if (!rule.events.includes(log.event)) return false;
  }
  return true;
}

/** Evaluate one rule against one log, returning an Alert if it fires. */
export function evalRule(
  rule: RuleDef,
  log: DecodedLog,
  contractName: string | null
): Alert | null {
  if (!ruleApplies(rule, log, contractName)) return null;
  const matched: Alert["matched"] = [];
  for (const clause of rule.when) {
    if (!evalClause(log, clause)) return null;
    matched.push({
      field: clause.field,
      op: clause.op,
      value: clause.value,
      actual: fieldValue(log, clause.field),
    });
  }
  return {
    ruleId: rule.id,
    severity: rule.severity ?? "info",
    description: rule.description ?? "",
    contractName,
    log,
    matched,
  };
}

export interface ScanResult {
  alerts: Alert[];
  logsProcessed: number;
  /** Logs whose address matched no declared contract. */
  unattributed: number;
}

/**
 * Scan a batch of decoded logs against all rules in the config.
 *
 * Logs are attributed to contracts by address. Rules without contract/event
 * restrictions are evaluated against every log; restricted rules are filtered.
 * Order of alerts follows (log order, then rule declaration order).
 */
export function scan(cfg: ChainwatchConfig, logs: DecodedLog[]): ScanResult {
  const index = new ContractIndex(cfg.contracts);
  const alerts: Alert[] = [];
  let unattributed = 0;

  for (const log of logs) {
    const contract = index.forAddress(log.address);
    const contractName = contract ? contract.name : null;
    if (!contract) unattributed++;
    for (const rule of cfg.rules) {
      const alert = evalRule(rule, log, contractName);
      if (alert) alerts.push(alert);
    }
  }

  return { alerts, logsProcessed: logs.length, unattributed };
}
