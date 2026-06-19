import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
// dist/test/cli.test.js -> dist/src/cli.js
const cli = join(here, "..", "src", "cli.js");
const fixtureConfig = join(here, "fixtures", "config.json");
const fixtureLogs = join(here, "fixtures", "logs.json");

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

test("validate on good config exits 0", () => {
  const r = run(["validate", fixtureConfig]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /OK: config is valid/);
});

test("validate on bad JSON exits non-zero", () => {
  const r = run(["validate", join(here, "fixtures", "does-not-exist.json")]);
  assert.notEqual(r.status, 0);
});

test("scan prints alerts and exits 0 without --fail-on-match", () => {
  const r = run(["scan", fixtureConfig, "--logs", fixtureLogs]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /big-transfer/);
  assert.match(r.stdout, /from-flagged/);
  assert.match(r.stdout, /exact-event/);
});

test("scan --json emits parseable JSON with alertCount", () => {
  const r = run(["scan", fixtureConfig, "--logs", fixtureLogs, "--json"]);
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.logsProcessed, 4);
  assert.equal(parsed.alertCount, 3);
  assert.equal(parsed.alerts.length, 3);
});

test("scan --fail-on-match exits 2 when alerts fire", () => {
  const r = run(["scan", fixtureConfig, "--logs", fixtureLogs, "--fail-on-match"]);
  assert.equal(r.status, 2);
});

test("rules lists declared rules", () => {
  const r = run(["rules", fixtureConfig]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /big-transfer/);
  assert.match(r.stdout, /3 rule\(s\)/);
});

test("rules --json emits an array", () => {
  const r = run(["rules", fixtureConfig, "--json"]);
  assert.equal(r.status, 0);
  const arr = JSON.parse(r.stdout);
  assert.ok(Array.isArray(arr));
  assert.equal(arr.length, 3);
});

test("new scaffolds files that then validate and scan", () => {
  const dir = mkdtempSync(join(tmpdir(), "chainwatch-"));
  try {
    const cfg = join(dir, "c.json");
    const logs = join(dir, "l.json");
    const created = run(["new", "--config", cfg, "--logs", logs]);
    assert.equal(created.status, 0);
    assert.match(created.stdout, /created/);

    const v = run(["validate", cfg]);
    assert.equal(v.status, 0);

    const s = run(["scan", cfg, "--logs", logs, "--json"]);
    assert.equal(s.status, 0);
    const parsed = JSON.parse(s.stdout);
    assert.ok(parsed.alertCount >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help exits 0; no command exits 1", () => {
  assert.equal(run(["help"]).status, 0);
  assert.equal(run([]).status, 1);
  assert.equal(run(["bogus"]).status, 1);
});

test("examples config + logs validate and scan", () => {
  // here = dist/test ; repo root (where examples/ lives) is two levels up
  const exCfg = join(here, "..", "..", "examples", "config.json");
  const exLogs = join(here, "..", "..", "examples", "logs.json");
  assert.equal(run(["validate", exCfg]).status, 0);
  const s = run(["scan", exCfg, "--logs", exLogs, "--json"]);
  assert.equal(s.status, 0);
  const parsed = JSON.parse(s.stdout);
  assert.ok(parsed.alertCount >= 1);
});
