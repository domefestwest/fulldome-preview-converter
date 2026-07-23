#!/usr/bin/env node
/**
 * Dev-only test harness for the Fulldome Preview Converter.
 *
 * Two independent modes:
 *
 *   1. Backend matrix — drives the converter binary/CLI directly, no
 *      Electron involved at all. Fastest way to check "does this
 *      scale/crop/encoder/option combo actually produce the right file."
 *
 *        node scripts/dev-test.js matrix
 *
 *   2. Live app — launches the real Electron app with an INVISIBLE window
 *      (show:false) and the Chrome DevTools Protocol attached, so it can be
 *      driven from the command line instead of clicking through it. A tiny
 *      test-only hook (window.__dfwTest) is attached by the renderer ONLY
 *      when launched this way — it never exists in a normal run or in any
 *      packaged/shipped build.
 *
 *        node scripts/dev-test.js launch
 *        node scripts/dev-test.js load-file "/path/to/file.mp4"
 *        node scripts/dev-test.js state
 *        node scripts/dev-test.js eval "document.title"
 *        node scripts/dev-test.js resize 720 700
 *        node scripts/dev-test.js check-layout
 *        node scripts/dev-test.js screenshot out.png
 *        node scripts/dev-test.js stop
 *
 * Requires Node 22+. Not used in CI, not shipped with the app.
 */

const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { CDPClient, getPageWsUrl } = require("./lib/cdp-client");

const REPO_ROOT   = path.resolve(__dirname, "..");
const GUI_DIR     = path.join(REPO_ROOT, "gui");
const STATE_FILE  = path.join(REPO_ROOT, ".dev-test-state.json");
const CDP_PORT    = 9333;

// ---------------------------------------------------------------------------
// State file — remembers the running hidden instance across CLI invocations
// ---------------------------------------------------------------------------

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return null; }
}
function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function clearState() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

async function connectToRunning() {
  const state = readState();
  if (!state) throw new Error(`No running instance found. Run: node scripts/dev-test.js launch`);
  const wsUrl = await getPageWsUrl(state.port);
  const client = new CDPClient(wsUrl);
  await client.connect();
  return client;
}

// ---------------------------------------------------------------------------
// Command: launch / stop
// ---------------------------------------------------------------------------

async function cmdLaunch() {
  const existing = readState();
  if (existing) {
    try {
      process.kill(existing.pid, 0); // check if still alive
      console.log(`Already running (pid ${existing.pid}, port ${existing.port}). Run "stop" first if you want to relaunch.`);
      return;
    } catch { clearState(); } // stale state file, process is gone
  }

  if (!fs.existsSync(path.join(GUI_DIR, "dist", "index.html"))) {
    console.log("No dist/ build found — building once...");
    execFileSync("npm", ["run", "build"], { cwd: GUI_DIR, stdio: "inherit" });
  }

  console.log(`Launching hidden Electron instance (CDP port ${CDP_PORT})...`);
  const proc = spawn(
    "npx",
    ["electron", ".", `--remote-debugging-port=${CDP_PORT}`],
    {
      cwd: GUI_DIR,
      env: { ...process.env, NODE_ENV: "production", DFW_TEST_HIDDEN: "1" },
      detached: true,
      stdio: "ignore",
    }
  );
  proc.unref();

  // Wait for the CDP port to come up
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      await getPageWsUrl(CDP_PORT);
      writeState({ pid: proc.pid, port: CDP_PORT });
      console.log(`Ready. pid=${proc.pid} port=${CDP_PORT}`);
      console.log(`Window is hidden — use "screenshot" or "eval" to inspect it.`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  proc.kill();
  throw new Error("Timed out waiting for Electron to start.");
}

function cmdStop() {
  const state = readState();
  if (!state) { console.log("Nothing running."); return; }
  try { process.kill(state.pid); console.log(`Stopped pid ${state.pid}.`); }
  catch { console.log("Process was already gone."); }
  clearState();
}

// ---------------------------------------------------------------------------
// Command: eval / state / load-file / resize / screenshot
// ---------------------------------------------------------------------------

async function cmdEval(expr) {
  const client = await connectToRunning();
  try {
    const value = await client.evaluate(expr, { awaitPromise: true });
    console.log(JSON.stringify(value, null, 2));
  } finally {
    client.close();
  }
}

async function cmdState() {
  const client = await connectToRunning();
  try {
    const value = await client.evaluate(`
      (() => window.__dfwTest ? JSON.stringify(window.__dfwTest.getState()) : JSON.stringify({error: "test hook not present — was this launched via dev-test.js?"}))()
    `);
    console.log(JSON.stringify(JSON.parse(value), null, 2));
  } finally {
    client.close();
  }
}

async function cmdLoadFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const client = await connectToRunning();
  try {
    await client.evaluate(`window.__dfwTest.loadFile(${JSON.stringify(abs)})`);
    // Poll until the file finishes loading (probe + frame extraction is async)
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const raw = await client.evaluate(`JSON.stringify(window.__dfwTest.getState())`);
      const state = JSON.parse(raw);
      if (state.file && !state.frameLoading) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log("Timed out waiting for file to finish loading. Last state:");
    console.log(await client.evaluate(`JSON.stringify(window.__dfwTest.getState())`));
  } finally {
    client.close();
  }
}

async function cmdResize(w, h) {
  const client = await connectToRunning();
  try {
    const ok = await client.evaluate(`window.__dfwTest.resize(${Number(w)}, ${Number(h)})`, { awaitPromise: true });
    if (!ok) throw new Error("Resize failed — is window.__dfwTest present? (was this launched via dev-test.js?)");
    console.log(`Resized to ${w}x${h}`);
  } finally {
    client.close();
  }
}

async function cmdScreenshot(outPath) {
  const client = await connectToRunning();
  try {
    const png = await client.screenshot();
    const dest = outPath || path.join(REPO_ROOT, "dev-test-screenshot.png");
    fs.writeFileSync(dest, png);
    console.log(`Saved ${dest} (${(png.length / 1024).toFixed(0)} KB)`);
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Command: check-layout — the CSS/overflow/scrubber-visibility check
// ---------------------------------------------------------------------------

const LAYOUT_CHECK_SIZES = [
  { label: "min size (720x700)",   w: 720,  h: 700 },
  { label: "small (720x600)",      w: 720,  h: 600 },
  { label: "default (820x820)",    w: 820,  h: 820 },
  { label: "wide (1400x900)",      w: 1400, h: 900 },
  { label: "tall narrow (760x1200)", w: 760, h: 1200 },
];

const LAYOUT_PROBE_JS = `
(() => {
  const body = document.body;
  const scrubRow = document.querySelector('[class*="scrubRow"]');
  const main = document.querySelector('[class*="main"]');
  const result = {
    windowSize: [window.innerWidth, window.innerHeight],
    bodyHorizontalOverflow: body.scrollWidth > window.innerWidth,
    mainHorizontalOverflow: main ? main.scrollWidth > main.clientWidth : null,
    scrubRowPresent: !!scrubRow,
    scrubRowVisible: null,
    scrubRowClipped: null,
  };
  if (scrubRow) {
    const rect = scrubRow.getBoundingClientRect();
    result.scrubRowVisible = rect.width > 0 && rect.height > 0;
    // "Clipped" = it exists and has size, but falls outside the visible viewport
    // and there's no way to scroll to it (main isn't scrollable to reach it).
    const withinViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
    const mainScrollable = main && main.scrollHeight > main.clientHeight;
    result.scrubRowClipped = !withinViewport && !mainScrollable;
    result.scrubRowRect = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  }
  return JSON.stringify(result);
})()
`;

async function cmdCheckLayout(testFilePath) {
  const client = await connectToRunning();
  try {
    // Load a file first so the scrubber has something to render (it's hidden
    // with no file loaded / for images / when duration is unknown).
    const filePath = testFilePath || path.join(REPO_ROOT, "context", "Test Fulldome File 1.mp4");
    if (fs.existsSync(filePath)) {
      await client.evaluate(`window.__dfwTest.loadFile(${JSON.stringify(path.resolve(filePath))})`);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const raw = await client.evaluate(`JSON.stringify(window.__dfwTest.getState())`);
        const appState = JSON.parse(raw);
        if (appState.file && !appState.frameLoading) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    } else {
      console.log(`(No test file at ${filePath} — checking layout with empty state only.)`);
    }

    console.log("\nLayout check across window sizes:\n");
    const rows = [];
    for (const size of LAYOUT_CHECK_SIZES) {
      await client.evaluate(`window.__dfwTest.resize(${size.w}, ${size.h})`, { awaitPromise: true });
      await new Promise((r) => setTimeout(r, 300)); // let CSS reflow settle
      const raw = await client.evaluate(LAYOUT_PROBE_JS);
      const probe = JSON.parse(raw);
      rows.push({ size: size.label, ...probe });

      const issues = [];
      if (probe.bodyHorizontalOverflow) issues.push("BODY OVERFLOWS HORIZONTALLY");
      if (probe.mainHorizontalOverflow) issues.push("MAIN OVERFLOWS HORIZONTALLY");
      if (probe.scrubRowPresent && !probe.scrubRowVisible) issues.push("SCRUBBER HAS ZERO SIZE");
      if (probe.scrubRowClipped) issues.push("SCRUBBER CLIPPED / UNREACHABLE");
      const [actualW, actualH] = probe.windowSize;
      const clampNote = (actualW !== size.w || actualH !== size.h)
        ? ` (clamped to ${actualW}x${actualH} — window has a minWidth/minHeight constraint)`
        : "";

      const status = issues.length ? `FAIL — ${issues.join(", ")}` : "OK";
      console.log(`  [${status === "OK" ? "✓" : "✗"}] ${size.label.padEnd(22)} ${status}${clampNote}`);
    }

    console.log("\nFull detail:");
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Command: matrix — backend-only conversion correctness matrix
// ---------------------------------------------------------------------------

function findConvertBinary() {
  const candidates = [
    path.join(REPO_ROOT, "bin", "dfw-convert"),
    path.join(REPO_ROOT, "bin", "dfw-convert.exe"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return { cmd: c, baseArgs: [] };
  return { cmd: "python3", baseArgs: [path.join(REPO_ROOT, "convert.py")] };
}

function ffprobeInfo(filePath) {
  const bin = fs.existsSync(path.join(REPO_ROOT, "bin", "ffprobe"))
    ? path.join(REPO_ROOT, "bin", "ffprobe")
    : "ffprobe";
  try {
    const out = execFileSync(bin, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration,codec_name",
      "-of", "json", filePath,
    ], { encoding: "utf8" });
    const data = JSON.parse(out);
    return data.streams?.[0] || null;
  } catch {
    return null;
  }
}

const DEFAULT_TEST_INPUT = path.join(REPO_ROOT, "context", "Test Fulldome File 1.mp4");

// Each case: { name, args (CLI flags array), expect: {w, h, minDur, maxDur} }
const MATRIX_CASES = [
  { name: "16:9 default",        args: ["--crop-mode", "16:9"],                         expect: { w: 1920, h: 1080 } },
  { name: "9:16 vertical",       args: ["--crop-mode", "9:16"],                          expect: { w: 1080, h: 1920 } },
  { name: "1:1 square",          args: ["--crop-mode", "1:1"],                           expect: { w: 1080, h: 1080 } },
  { name: "scale 150 + hpan 25", args: ["--scale", "1.5", "--h-pan", "25"],              expect: { w: 1920, h: 1080 } },
  { name: "sweet-spot 0 (top)",  args: ["--sweet-spot", "0"],                            expect: { w: 1920, h: 1080 } },
  { name: "sweet-spot 100 (bot)",args: ["--sweet-spot", "100"],                          expect: { w: 1920, h: 1080 } },
  { name: "no-pip",              args: ["--no-pip"],                                     expect: { w: 1920, h: 1080 } },
  { name: "no-pip + 1:1",        args: ["--no-pip", "--crop-mode", "1:1"],               expect: { w: 1080, h: 1080 } },
  { name: "pip bottom-left",     args: ["--pip-position", "bl"],                         expect: { w: 1920, h: 1080 } },
  { name: "forced CPU encode",   args: ["--no-hw-accel"],                                expect: { w: 1920, h: 1080 } },
  { name: "manual bitrate",      args: ["--bitrate", "6000"],                            expect: { w: 1920, h: 1080 } },
  { name: "burn-in title+fname", args: ["--burnin-title", "Test Film", "--burnin-filename", "--burnin-corner", "br"], expect: { w: 1920, h: 1080 } },
  { name: "slate bar",           args: ["--slate-title", "Test", "--slate-creator", "DFW", "--slate-year", "2026"], expect: { w: 1920, h: 1188 } }, // +10% bar
  { name: "color tag + loudnorm",args: ["--color-tag", "bt709", "--loudnorm", "-23"],    expect: { w: 1920, h: 1080 } },
  { name: "audio passthrough",   args: ["--audio", "passthrough"],                       expect: { w: 1920, h: 1080 } },
];

async function cmdMatrix() {
  if (!fs.existsSync(DEFAULT_TEST_INPUT)) {
    throw new Error(`Test input not found: ${DEFAULT_TEST_INPUT}`);
  }
  const runner = findConvertBinary();
  const outDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "dfw-matrix-"));
  console.log(`Engine: ${runner.cmd}`);
  console.log(`Output dir: ${outDir}\n`);

  const results = [];
  for (const tc of MATRIX_CASES) {
    const outPath = path.join(outDir, `${tc.name.replace(/[^a-z0-9]+/gi, "_")}.mp4`);
    const args = [
      ...runner.baseArgs,
      "--input", DEFAULT_TEST_INPUT,
      "--output", outPath,
      "--resolution", "1080p",
      "--crf", "30",
      "--trim-start", "0",
      "--trim-end", "3",
      ...tc.args,
    ];
    const start = Date.now();
    let status = "PASS", detail = "";
    try {
      execFileSync(runner.cmd, args, { encoding: "utf8", timeout: 60000 });
      const info = ffprobeInfo(outPath);
      if (!info) {
        status = "FAIL"; detail = "no output file / unreadable";
      } else {
        const wOk = !tc.expect.w || info.width === tc.expect.w;
        const hOk = !tc.expect.h || info.height === tc.expect.h;
        if (!wOk || !hOk) {
          status = "FAIL";
          detail = `expected ${tc.expect.w}x${tc.expect.h}, got ${info.width}x${info.height}`;
        } else {
          detail = `${info.width}x${info.height}, ${parseFloat(info.duration).toFixed(1)}s, ${info.codec_name}`;
        }
      }
    } catch (e) {
      status = "FAIL";
      detail = (e.stderr || e.message || "").toString().trim().split("\n").slice(-1)[0];
    }
    const ms = Date.now() - start;
    results.push({ name: tc.name, status, detail, ms });
    const icon = status === "PASS" ? "✓" : "✗";
    console.log(`  [${icon}] ${tc.name.padEnd(24)} ${detail}  (${ms}ms)`);
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log(`\nFailures:`);
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
  console.log(`\n(Outputs kept at ${outDir} for inspection — delete manually when done.)`);
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

async function main() {
  const [, , cmd, ...args] = process.argv;
  switch (cmd) {
    case "matrix":        return cmdMatrix();
    case "launch":         return cmdLaunch();
    case "stop":           return cmdStop();
    case "eval":           return cmdEval(args.join(" "));
    case "state":          return cmdState();
    case "load-file":      return cmdLoadFile(args[0]);
    case "resize":          return cmdResize(args[0], args[1]);
    case "screenshot":     return cmdScreenshot(args[0]);
    case "check-layout":   return cmdCheckLayout(args[0]);
    default:
      console.log(`Usage: node scripts/dev-test.js <command> [args]

Backend (no app window):
  matrix                       Run the conversion config matrix, verify with ffprobe

Live app (hidden window, driven via DevTools Protocol):
  launch                       Start a hidden instance
  stop                         Stop it
  state                        Print current app state (file, settings, status)
  load-file <path>             Load a file, wait for it to finish loading
  eval "<js>"                  Evaluate arbitrary JS in the renderer, print result
  resize <w> <h>                Resize the native window
  check-layout [testFile]      Check for CSS overflow / clipped scrubber across sizes
  screenshot [outPath]         Save a PNG of the current (hidden) window
`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
