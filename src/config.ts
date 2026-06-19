/**
 * Config loading and validation for chainwatch.
 *
 * Validation is structural and semantic: it checks that contracts have valid
 * addresses and event signatures, that rules reference known contracts/events,
 * and that every clause uses a supported operator with a sane value.
 */

import { readFile } from "node:fs/promises";
import type {
  ChainwatchConfig,
  ContractDef,
  Operator,
  RuleDef,
  ValidationResult,
} from "./types.js";
import { eventName } from "./keccak.js";

export const OPERATORS: readonly Operator[] = [
  "eq",
  "gt",
  "lt",
  "contains",
  "from-address",
] as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const EVENT_SIG_RE = /^[A-Za-z_]\w*\s*\(([^()]*)\)$/;

/** Read and JSON-parse a config file. Throws on read/parse error. */
export async function loadConfig(path: string): Promise<ChainwatchConfig> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `config ${path} is not valid JSON: ${(err as Error).message}`
    );
  }
  return parsed as ChainwatchConfig;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate a parsed config object. Never throws; returns structured result. */
export function validateConfig(cfg: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(cfg)) {
    return { ok: false, errors: ["config root must be a JSON object"], warnings };
  }

  // ---- contracts ----
  const contractNames = new Set<string>();
  const eventNamesByContract = new Map<string, Set<string>>();
  const allEventNames = new Set<string>();

  if (!Array.isArray(cfg.contracts)) {
    errors.push("`contracts` must be an array");
  } else if (cfg.contracts.length === 0) {
    warnings.push("`contracts` is empty — no logs will ever be attributed");
  } else {
    cfg.contracts.forEach((c, i) => {
      const where = `contracts[${i}]`;
      if (!isObject(c)) {
        errors.push(`${where} must be an object`);
        return;
      }
      const cc = c as Partial<ContractDef>;
      if (typeof cc.name !== "string" || cc.name.trim() === "") {
        errors.push(`${where}.name is required (non-empty string)`);
      } else if (contractNames.has(cc.name)) {
        errors.push(`${where}.name "${cc.name}" is duplicated`);
      } else {
        contractNames.add(cc.name);
      }
      if (typeof cc.address !== "string" || !ADDRESS_RE.test(cc.address)) {
        errors.push(
          `${where}.address must be a 0x-prefixed 20-byte hex address`
        );
      }
      const evset = new Set<string>();
      if (!Array.isArray(cc.events) || cc.events.length === 0) {
        errors.push(`${where}.events must be a non-empty array of signatures`);
      } else {
        cc.events.forEach((sig, j) => {
          if (typeof sig !== "string" || !EVENT_SIG_RE.test(sig.replace(/\s+/g, ""))) {
            errors.push(
              `${where}.events[${j}] "${String(
                sig
              )}" is not a valid event signature like "Transfer(address,address,uint256)"`
            );
          } else {
            const en = eventName(sig);
            evset.add(en);
            allEventNames.add(en);
          }
        });
      }
      if (typeof cc.name === "string") {
        eventNamesByContract.set(cc.name, evset);
      }
    });
  }

  // ---- rules ----
  const ruleIds = new Set<string>();
  if (!Array.isArray(cfg.rules)) {
    errors.push("`rules` must be an array");
  } else if (cfg.rules.length === 0) {
    warnings.push("`rules` is empty — scan will never produce alerts");
  } else {
    cfg.rules.forEach((r, i) => {
      const where = `rules[${i}]`;
      if (!isObject(r)) {
        errors.push(`${where} must be an object`);
        return;
      }
      const rr = r as Partial<RuleDef>;
      if (typeof rr.id !== "string" || rr.id.trim() === "") {
        errors.push(`${where}.id is required (non-empty string)`);
      } else if (ruleIds.has(rr.id)) {
        errors.push(`${where}.id "${rr.id}" is duplicated`);
      } else {
        ruleIds.add(rr.id);
      }
      if (rr.severity !== undefined && typeof rr.severity !== "string") {
        errors.push(`${where}.severity must be a string when present`);
      }
      if (rr.description !== undefined && typeof rr.description !== "string") {
        errors.push(`${where}.description must be a string when present`);
      }
      if (rr.contracts !== undefined) {
        if (!Array.isArray(rr.contracts)) {
          errors.push(`${where}.contracts must be an array when present`);
        } else {
          rr.contracts.forEach((cn, j) => {
            if (typeof cn !== "string") {
              errors.push(`${where}.contracts[${j}] must be a string`);
            } else if (contractNames.size > 0 && !contractNames.has(cn)) {
              errors.push(
                `${where}.contracts[${j}] "${cn}" does not match any declared contract`
              );
            }
          });
        }
      }
      if (rr.events !== undefined) {
        if (!Array.isArray(rr.events)) {
          errors.push(`${where}.events must be an array when present`);
        } else {
          rr.events.forEach((en, j) => {
            if (typeof en !== "string") {
              errors.push(`${where}.events[${j}] must be a string`);
            } else if (allEventNames.size > 0 && !allEventNames.has(en)) {
              warnings.push(
                `${where}.events[${j}] "${en}" is not declared on any contract`
              );
            }
          });
        }
      }
      if (!Array.isArray(rr.when) || rr.when.length === 0) {
        errors.push(`${where}.when must be a non-empty array of clauses`);
      } else {
        rr.when.forEach((cl, j) => {
          const cw = `${where}.when[${j}]`;
          if (!isObject(cl)) {
            errors.push(`${cw} must be an object`);
            return;
          }
          if (typeof cl.field !== "string" || cl.field.trim() === "") {
            errors.push(`${cw}.field is required (non-empty string)`);
          }
          if (typeof cl.op !== "string" || !OPERATORS.includes(cl.op as Operator)) {
            errors.push(
              `${cw}.op must be one of: ${OPERATORS.join(", ")} (got ${String(
                cl.op
              )})`
            );
          }
          if (cl.value === undefined || cl.value === null) {
            errors.push(`${cw}.value is required`);
          } else if (
            typeof cl.value !== "string" &&
            typeof cl.value !== "number"
          ) {
            errors.push(`${cw}.value must be a string or number`);
          }
          // operator-specific sanity
          if (cl.op === "gt" || cl.op === "lt") {
            if (!isNumericLike(cl.value)) {
              errors.push(
                `${cw}.value must be numeric for op "${cl.op}" (got ${String(
                  cl.value
                )})`
              );
            }
          }
          if (cl.op === "from-address") {
            if (
              typeof cl.value !== "string" ||
              !ADDRESS_RE.test(cl.value)
            ) {
              errors.push(
                `${cw}.value must be a 0x address for op "from-address"`
              );
            }
          }
        });
      }
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isNumericLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return false;
    return /^-?\d+$/.test(t) || /^-?\d*\.\d+$/.test(t);
  }
  return false;
}
