/**
 * Core type definitions for chainwatch.
 *
 * chainwatch watches EVM (Ethereum / Arbitrum) contract events and fires
 * alerts when declared rules match. These types describe the on-disk config
 * format, the decoded log shape used by fixtures and live providers, and the
 * result objects produced when rules are evaluated.
 */

/** A supported comparison/match operator for a rule clause. */
export type Operator = "eq" | "gt" | "lt" | "contains" | "from-address";

/**
 * A single watched contract. A contract groups a human-readable name with an
 * EVM address and the set of event signatures we care about on it.
 */
export interface ContractDef {
  /** Human-readable label used in alert output. */
  name: string;
  /** 0x-prefixed 20-byte EVM address (case-insensitive). */
  address: string;
  /**
   * Event signatures watched on this contract, e.g.
   * "Transfer(address,address,uint256)". Used to compute the topic0 hash and
   * to name the decoded fields.
   */
  events: string[];
}

/**
 * A single clause of a rule. A clause inspects one named field of a decoded
 * log (or a synthetic field such as `address` / `event`) and compares it
 * against `value` using `op`.
 */
export interface RuleClause {
  /**
   * Field to inspect. May be a decoded event argument name (e.g. "value"),
   * or one of the synthetic fields: "address" (emitting contract),
   * "event" (event name), "from" (synthetic alias handled by from-address).
   */
  field: string;
  op: Operator;
  /** Comparison value. Numbers compared as BigInt when both sides parse. */
  value: string | number;
}

/** An alert rule: a named, optionally-severity-tagged set of ANDed clauses. */
export interface RuleDef {
  /** Unique rule id used in alert output and `--fail-on-match`. */
  id: string;
  /** Optional human description. */
  description?: string;
  /** Optional severity label, free-form (e.g. "info", "warn", "critical"). */
  severity?: string;
  /**
   * Optional restriction: only evaluate this rule against logs from these
   * contract names (as declared in `contracts[].name`). Empty/absent = all.
   */
  contracts?: string[];
  /** Optional restriction by event name. Empty/absent = all events. */
  events?: string[];
  /** Clauses; all must match (logical AND) for the rule to fire. */
  when: RuleClause[];
}

/** Top-level chainwatch configuration. */
export interface ChainwatchConfig {
  /** Optional config name. */
  name?: string;
  /** Optional chain hint, e.g. "ethereum" | "arbitrum". Informational only. */
  chain?: string;
  contracts: ContractDef[];
  rules: RuleDef[];
}

/**
 * A decoded log entry. This is the unit chainwatch evaluates rules against.
 * Fixtures supply these directly; a live provider would decode raw RPC logs
 * into this shape.
 */
export interface DecodedLog {
  /** Emitting contract address (0x, 20 bytes). */
  address: string;
  /** Decoded event name, e.g. "Transfer". */
  event: string;
  /** Decoded named arguments. Values are strings or numbers. */
  args: Record<string, string | number>;
  /** Optional block number for context/output. */
  blockNumber?: number;
  /** Optional transaction hash for context/output. */
  transactionHash?: string;
  /** Optional log index within the block. */
  logIndex?: number;
  /** Optional raw topic0 (0x keccak of the event signature). */
  topic0?: string;
}

/** A fired alert: a rule that matched a specific log. */
export interface Alert {
  ruleId: string;
  severity: string;
  description: string;
  contractName: string | null;
  log: DecodedLog;
  /** Per-clause explanation of why the rule matched. */
  matched: Array<{ field: string; op: Operator; value: string | number; actual: string | number | undefined }>;
}

/** Result of validating a config. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
