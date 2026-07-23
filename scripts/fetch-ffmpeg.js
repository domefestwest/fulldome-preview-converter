#!/usr/bin/env node
/**
 * Cross-platform FFmpeg + ffprobe fetcher.
 *
 * Downloads the right static binaries for the *host* platform and extracts
 * them to <repo>/bin/. Run before electron-builder so the installer bundles
 * a working FFmpeg out of the box.
 *
 * Usage:
 *   node scripts/fetch-ffmpeg.js                  # autodetect host platform/arch
 *   node scripts/fetch-ffmpeg.js --target=mac-arm64
 *   node scripts/fetch-ffmpeg.js --target=mac-x64
 *   node scripts/fetch-ffmpeg.js --target=win-x64
 *   node scripts/fetch-ffmpeg.js --target=linux-x64
 *
 * Sources (all stable static GPL builds):
 *   - macOS Apple Silicon: https://ffmpeg.martin-riedl.de
 *   - macOS Intel:         https://evermeet.cx
 *   - Windows x64:         https://github.com/BtbN/FFmpeg-Builds
 *   - Linux x64:           https://github.com/BtbN/FFmpeg-Builds
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const BIN_DIR   = path.join(REPO_ROOT, "bin");
const TMP_DIR   = path.join(REPO_ROOT, ".ffmpeg-cache");

const TARGETS = {
  "mac-arm64": {
    ffmpeg:   "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip",
    ffprobe:  "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffprobe.zip",
    extract:  "zip",
    binNames: { ffmpeg: "ffmpeg", ffprobe: "ffprobe" },
  },
  "mac-x64": {
    ffmpeg:   "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip",
    ffprobe:  "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip",
    extract:  "zip",
    binNames: { ffmpeg: "ffmpeg", ffprobe: "ffprobe" },
  },
  "win-x64": {
    bundle:   "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
    extract:  "zip-bundle",
    binNames: { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" },
    bundleSubdir: "ffmpeg-master-latest-win64-gpl/bin",
  },
  "linux-x64": {
    bundle:   "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
    extract:  "tar-xz",
    binNames: { ffmpeg: "ffmpeg", ffprobe: "ffprobe" },
    bundleSubdir: "ffmpeg-master-latest-linux64-gpl/bin",
  },
};

function detectTarget() {
  const arg = process.argv.find((a) => a.startsWith("--target="));
  if (arg) return arg.split("=")[1];
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin")  return arch === "arm64" ? "mac-arm64" : "mac-x64";
  if (platform === "win32")   return "win-x64";
  if (platform === "linux")   return "linux-x64";
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

function download(url, outPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects for ${url}`));
        // Some servers (e.g. martin-riedl.de) send a relative Location
        // header ("/download/..."), which https.get() can't use directly —
        // resolve it against the URL that produced this redirect, not the
        // original request, so multi-hop redirect chains work correctly.
        const nextUrl = new URL(res.headers.location, url).href;
        return download(nextUrl, outPath, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let received = 0;
      let lastReported = 0;
      res.on("data", (chunk) => {
        received += chunk.length;
        const pct = total > 0 ? Math.floor((received / total) * 100) : 0;
        if (pct >= lastReported + 10) {
          lastReported = pct;
          process.stdout.write(`\r  ${pct}% (${(received/1024/1024).toFixed(1)} MB)`);
        }
      });
      res.pipe(file);
      file.on("finish", () => {
        process.stdout.write("\r  ✓ 100%                            \n");
        file.close(resolve);
      });
    }).on("error", reject);
  });
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

async function fetchTarget(target) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`Unknown target: ${target}. Choices: ${Object.keys(TARGETS).join(", ")}`);

  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  console.log(`\n→ Fetching FFmpeg for ${target}...`);

  if (spec.extract === "zip") {
    // Separate ffmpeg and ffprobe zips
    for (const which of ["ffmpeg", "ffprobe"]) {
      const url = spec[which];
      const zipPath = path.join(TMP_DIR, `${target}-${which}.zip`);
      console.log(`  ${which}: ${url}`);
      await download(url, zipPath);
      // Extract using unzip (available on macOS by default)
      run(`unzip -q -o "${zipPath}" -d "${BIN_DIR}"`);
      const dest = path.join(BIN_DIR, spec.binNames[which]);
      if (process.platform !== "win32") run(`chmod +x "${dest}"`);
    }
  } else if (spec.extract === "zip-bundle") {
    // Single zip containing ffmpeg.exe + ffprobe.exe
    const zipPath = path.join(TMP_DIR, `${target}.zip`);
    console.log(`  bundle: ${spec.bundle}`);
    await download(spec.bundle, zipPath);
    const extractDir = path.join(TMP_DIR, `${target}-extract`);
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    run(`unzip -q -o "${zipPath}" -d "${extractDir}"`);
    for (const which of ["ffmpeg", "ffprobe"]) {
      const src = path.join(extractDir, spec.bundleSubdir, spec.binNames[which]);
      const dst = path.join(BIN_DIR, spec.binNames[which]);
      fs.copyFileSync(src, dst);
    }
  } else if (spec.extract === "tar-xz") {
    const tarPath = path.join(TMP_DIR, `${target}.tar.xz`);
    console.log(`  bundle: ${spec.bundle}`);
    await download(spec.bundle, tarPath);
    const extractDir = path.join(TMP_DIR, `${target}-extract`);
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    run(`tar -xJf "${tarPath}" -C "${extractDir}"`);
    for (const which of ["ffmpeg", "ffprobe"]) {
      const src = path.join(extractDir, spec.bundleSubdir, spec.binNames[which]);
      const dst = path.join(BIN_DIR, spec.binNames[which]);
      fs.copyFileSync(src, dst);
      run(`chmod +x "${dst}"`);
    }
  }

  console.log(`\n✓ ${target}: binaries placed in ${BIN_DIR}/`);
  // Final listing
  for (const which of ["ffmpeg", "ffprobe"]) {
    const p = path.join(BIN_DIR, spec.binNames[which]);
    if (fs.existsSync(p)) {
      const size = (fs.statSync(p).size / 1024 / 1024).toFixed(1);
      console.log(`    ${spec.binNames[which]}  ${size} MB`);
    } else {
      console.warn(`    ⚠ ${spec.binNames[which]}  MISSING`);
    }
  }
}

(async () => {
  const target = detectTarget();
  try {
    await fetchTarget(target);
  } catch (err) {
    console.error(`\n✗ Failed to fetch ${target}:`, err.message);
    process.exit(1);
  }
})();
