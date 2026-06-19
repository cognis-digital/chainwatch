/**
 * Public API surface for chainwatch when used as a library.
 *
 * The CLI (`src/cli.ts`) is a thin wrapper over these exports.
 */

export type {
  Operator,
  ContractDef,
  RuleClause,
  RuleDef,
  ChainwatchConfig,
  DecodedLog,
  Alert,
  ValidationResult,
} from "./types.js";

export { loadConfig, validateConfig, OPERATORS } from "./config.js";
export {
  scan,
  evalRule,
  evalClause,
  ContractIndex,
  type ScanResult,
} from "./engine.js";
export {
  type LogProvider,
  FixtureProvider,
  MemoryProvider,
  LiveRpcProvider,
  type LiveProviderOptions,
  parseLogs,
} from "./provider.js";
export { keccak256, toHex, eventTopic, eventName } from "./keccak.js";
export { scaffold, SCAFFOLD_CONFIG, SCAFFOLD_LOGS } from "./scaffold.js";
