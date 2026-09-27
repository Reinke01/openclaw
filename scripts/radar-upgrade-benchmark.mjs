#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function intArg(name, fallback) {
  const value = Number(arg(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function findUsage(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  const keys = Object.keys(node);
  const interesting = ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "inputTokens", "outputTokens"];
  if (interesting.some((k) => keys.includes(k))) acc.push(node);
  for (const value of Object.values(node)) findUsage(value, acc);
  return acc;
}

function normalizeUsage(json) {
  const nodes = findUsage(json);
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, total = 0;
  let found = false;
  for (const u of nodes) {
    const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
    const i = num(u.inputTokens ?? u.input);
    const o = num(u.outputTokens ?? u.output);
    const cr = num(u.cacheRead);
    const cw = num(u.cacheWrite);
    const t = num(u.totalTokens);
    if (i || o || cr || cw || t) {
      found = true;
      input = Math.max(input, i);
      output = Math.max(output, o);
      cacheRead = Math.max(cacheRead, cr);
      cacheWrite = Math.max(cacheWrite, cw);
      total = Math.max(total, t || i + o + cr + cw);
    }
  }
  return found ? { input, output, cacheRead, cacheWrite, totalTokens: total || input + output + cacheRead + cacheWrite } : null;
}

function extractText(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  for (const key of ["text", "reply", "response", "message", "content"]) {
    const value = node[key];
    if (typeof value === "string") return value;
  }
  for (const value of Object.values(node)) {
    const text = extractText(value);
    if (text) return text;
  }
  return "";
}

function runCli(dir, args, timeoutMs) {
  return new Promise((resolveRun) => {
    const entry = resolve(dir, "openclaw.mjs");
    if (!existsSync(entry)) throw new Error(`openclaw.mjs not found in ${dir}`);
    const started = Date.now();
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: dir,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      let json = null;
      try { json = JSON.parse(stdout.trim()); } catch {}
      resolveRun({ code, signal, durationMs, stdout, stderr, json });
    });
  });
}

function sameJson(actualText, expected) {
  try {
    const parsed = JSON.parse(actualText.trim());
    return Object.keys(expected).every((k) => parsed[k] === expected[k]);
  } catch {
    return false;
  }
}

async function oneTurn(dir, prompt, expected, timeoutMs, sessionId) {
  const run = await runCli(dir, [
    "agent", "--local", "--session-id", sessionId,
    "--message", prompt, "--json"
  ], timeoutMs);
  const text = extractText(run.json ?? run.stdout).trim();
  const pass = typeof expected === "string" ? text === expected : sameJson(text, expected);
  return { ...run, text, pass, usage: run.json ? normalizeUsage(run.json) : null };
}

async function suite(label, dir, runs, timeoutMs) {
  const rows = [];
  for (let i = 0; i < runs; i += 1) {
    const prefix = `radar-upgrade-${label}-${i}-${randomUUID()}`;

    const t1 = await oneTurn(dir, "Reply exactly with: OK", "OK", timeoutMs, `${prefix}-t1`);
    rows.push({ version: label, run: i + 1, task: "T1", ...t1 });

    const t2 = await oneTurn(
      dir,
      "From this record: asset=BTCUSDT; side=SHORT; rr=1.5; state=CONFIRMED. Return only JSON with keys asset, side, rr, state, preserving those values.",
      { asset: "BTCUSDT", side: "SHORT", rr: 1.5, state: "CONFIRMED" },
      timeoutMs,
      `${prefix}-t2`
    );
    rows.push({ version: label, run: i + 1, task: "T2", ...t2 });

    const sid3 = `${prefix}-t3`;
    const t3a = await oneTurn(
      dir,
      "Remember only these four values for this benchmark: asset BTCUSDT, side SHORT, stop 65000, target 62000. Reply exactly STORED.",
      "STORED", timeoutMs, sid3
    );
    const t3b = await oneTurn(
      dir,
      "Return only JSON with keys asset, side, stop, target using the four stored values.",
      { asset: "BTCUSDT", side: "SHORT", stop: 65000, target: 62000 },
      timeoutMs, sid3
    );
    rows.push({ version: label, run: i + 1, task: "T3a", ...t3a });
    rows.push({ version: label, run: i + 1, task: "T3b", ...t3b });
  }
  return rows;
}

function summarize(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.version;
    const g = groups.get(key) ?? { version: key, tasks: 0, passed: 0, failures: 0, durationMs: 0, totalTokens: 0, usageRows: 0 };
    g.tasks += 1;
    if (r.pass && r.code === 0) g.passed += 1; else g.failures += 1;
    g.durationMs += r.durationMs;
    if (r.usage) {
      g.totalTokens += r.usage.totalTokens ?? 0;
      g.usageRows += 1;
    }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    avgMs: Math.round(g.durationMs / Math.max(1, g.tasks)),
    tokensPerSuccessfulTask: g.passed && g.usageRows ? Math.round(g.totalTokens / g.passed) : null,
  }));
}

async function main() {
  const oldDir = resolve(arg("--old-dir"));
  const newDir = resolve(arg("--new-dir"));
  const runs = intArg("--runs", 3);
  const timeoutMs = intArg("--timeout-ms", 120000);

  console.error("Benchmarking with the CURRENT provider/model configuration in each checkout.");
  console.error("Ensure both checkouts use the same provider, model, thinking level and credentials.");
  console.error("No API keys are written by this script.");

  const oldRows = await suite("2026.2.6-3", oldDir, runs, timeoutMs);
  const newRows = await suite("2026.9.6", newDir, runs, timeoutMs);
  const result = {
    generatedAt: new Date().toISOString(),
    runs,
    oldDir,
    newDir,
    summary: summarize([...oldRows, ...newRows]),
    rows: [...oldRows, ...newRows].map(({ stdout, stderr, json, ...safe }) => ({
      ...safe,
      stderr: stderr ? stderr.slice(0, 1000) : "",
    })),
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
