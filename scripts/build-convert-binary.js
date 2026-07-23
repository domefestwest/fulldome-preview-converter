#!/usr/bin/env node
/**
 * Compiles convert.py into a standalone native executable via PyInstaller,
 * so the packaged app never depends on the end user having Python installed.
 *
 * PyInstaller cannot cross-compile — it always builds for the host platform
 * it runs on. In CI, this runs once per matrix OS (mac/win/linux), matching
 * the existing fetch-ffmpeg.js per-platform pattern.
 *
 * Output: bin/dfw-convert (mac/linux) or bin/dfw-convert.exe (win), plus a
 * bin/_internal/ support directory (PyInstaller --onedir mode). onedir is
 * used instead of --onefile because onefile's self-extracting behavior is
 * more likely to trip antivirus/SmartScreen heuristics on Windows, and it
 * has slower cold-start (unpacks to a temp dir on every run).
 *
 * Usage:
 *   node scripts/build-convert-binary.js
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const BIN_DIR   = path.join(REPO_ROOT, "bin");
const WORK_DIR  = path.join(REPO_ROOT, ".pyinstaller-build");
const ENTRY     = path.join(REPO_ROOT, "convert.py");

function findPython() {
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const p of candidates) {
    try {
      const out = execFileSync(p, ["--version"], { encoding: "utf8" });
      if (/Python 3\.(1[0-9]|[2-9][0-9])/.test(out)) return p;
    } catch {}
  }
  throw new Error("No Python 3.10+ found to run PyInstaller. Install Python 3.10+ to build the binary.");
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: REPO_ROOT });
}

(function main() {
  const python = findPython();
  console.log(`Using ${python} to build with PyInstaller...`);

  // Ensure PyInstaller is available (installs quietly if missing)
  try {
    execFileSync(python, ["-m", "PyInstaller", "--version"], { stdio: "ignore" });
  } catch {
    console.log("PyInstaller not found — installing...");
    run(python, ["-m", "pip", "install", "--quiet", "pyinstaller"]);
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.rmSync(WORK_DIR, { recursive: true, force: true });

  run(python, [
    "-m", "PyInstaller",
    "--onedir",
    "--name", "dfw-convert",
    "--distpath", BIN_DIR,
    "--workpath", path.join(WORK_DIR, "build"),
    "--specpath", WORK_DIR,
    "--noconfirm",
    "--console",
    ENTRY,
  ]);

  // PyInstaller --onedir puts everything inside bin/dfw-convert/ — flatten
  // it so the executable + _internal/ sit directly in bin/ alongside
  // ffmpeg/ffprobe/DejaVuSans.ttf (all fetched/placed there separately).
  // The nested output dir and the final exe share the name "dfw-convert",
  // so it's moved aside to a temp path first to avoid a self-collision.
  const nestedDir = path.join(BIN_DIR, "dfw-convert");
  const tempDir   = path.join(BIN_DIR, "dfw-convert-build-tmp");
  const exeName = process.platform === "win32" ? "dfw-convert.exe" : "dfw-convert";
  const finalExe = path.join(BIN_DIR, exeName);
  const finalInternal = path.join(BIN_DIR, "_internal");

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.renameSync(nestedDir, tempDir);

  const tempExe = path.join(tempDir, exeName);
  const tempInternal = path.join(tempDir, "_internal");

  fs.rmSync(finalExe, { force: true });
  fs.renameSync(tempExe, finalExe);

  fs.rmSync(finalInternal, { recursive: true, force: true });
  fs.renameSync(tempInternal, finalInternal);

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(WORK_DIR, { recursive: true, force: true });

  if (process.platform !== "win32") {
    fs.chmodSync(finalExe, 0o755);
  }

  const size = (fs.statSync(finalExe).size / 1024 / 1024).toFixed(1);
  console.log(`\n✓ Built ${finalExe} (${size} MB) + bin/_internal/`);
})();
