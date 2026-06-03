# Fulldome Preview Converter

**A free, open-source tool from [Dome Fest West](https://domefestwest.com) for independent fulldome creators.**

You made something extraordinary. A film designed to fill a dome — 360 degrees, fully immersive, the kind of experience that changes how someone sees the world. Now you need to show people what it looks like before they can see it in a planetarium.

That's the problem this tool solves.

The Fulldome Preview Converter takes your fulldome master file — the 1:1 circular fisheye format every fulldome film is shot in — and converts it to a 16:9 preview video. The kind you can post to Vimeo, send to a festival, share with a potential distributor, or drop into a sponsorship deck. A small picture-in-picture of the full circular frame sits in the corner, so viewers understand what they're actually looking at.

No subscription. No render farm. No hiring a post-production studio to do something that should take about five minutes. Just drag in your file, set your crop, hit Convert.

---

## Who This Is For

Independent fulldome filmmakers. Solo creators. Small studios working without a dedicated finishing artist. Anyone making dome content who needs a clean, professional-looking preview without spending three days and $500 on an edit.

The big studios have teams for this. You have this tool.

---

## What It Does

The converter applies a multi-layer composite to your fisheye master:

- **Background layer** — the fisheye is scaled to fill the output frame, then cropped vertically and horizontally. Sweet-spot and pan controls let you dial in exactly which part of the dome you want centered.
- **PiP overlay** — a small circular copy of the full fisheye sits in a corner of your choice, so viewers understand the format and see the full composition.
- **Optional finishing pass** — burn-in text, letterbox slate bar, watermark/logo, Rec.709 color tagging, and audio loudness normalization (-23 LUFS festival / -14 LUFS streaming).

**Three output formats:** 16:9 widescreen, 9:16 vertical (Instagram Reels, TikTok), 1:1 square. **GPU-accelerated on every platform** — VideoToolbox on Mac, NVENC on NVIDIA, AMF on Windows AMD, VAAPI on Linux AMD/Intel, Quick Sync on Intel — with automatic CPU fallback.

The output is H.264 MP4, ready for any platform.

---

## Download

Grab the latest installer for your platform from the [**Releases page**](https://github.com/domefestwest/fulldome-preview-converter/releases):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Fulldome-Preview-Converter-x.y.z-arm64.dmg` |
| macOS (Intel)         | `Fulldome-Preview-Converter-x.y.z.dmg` |
| Windows 10/11 (x64)   | `Fulldome-Preview-Converter-x.y.z.exe` |
| Linux (x64)           | `Fulldome-Preview-Converter-x.y.z.AppImage` |

Each installer bundles a static build of **FFmpeg + ffprobe** plus the **DejaVuSans** font, so there's nothing else to install except Python.

> **First-launch warning on Mac:** the app isn't code-signed yet (no Apple Developer ID). Right-click the app → Open → Open Anyway. Same on Windows: SmartScreen → "More info" → "Run anyway." These warnings will go away once we ship signed builds.

[Report issues here.](https://github.com/domefestwest/fulldome-preview-converter/issues)

---

## Requirements

**Python 3.10+** must be installed on your system. Everything else (FFmpeg, ffprobe, fonts) is bundled with the installer.

| Platform | Install Python |
|----------|----------------|
| macOS    | `brew install python` or [python.org/downloads](https://www.python.org/downloads/) |
| Windows  | Microsoft Store → "Python 3.12" or [python.org/downloads](https://www.python.org/downloads/) |
| Linux    | `sudo apt install python3` (already present on most distros) |

For building from source: **Node.js 18+** and **npm**.

---

## GUI — Desktop Application

```bash
git clone https://github.com/domefestwest/fulldome-preview-converter.git
cd fulldome-preview-converter/gui
npm install
npm start
```

### Controls

| Control | What it does |
|---------|-------------|
| **File drop zone** | Drag in your `.mp4` or click to browse. Shows detected resolution after load. |
| **Live Preview** | Canvas preview updates instantly as you adjust settings. Scrub the timeline to find the right frame. |
| **Output Resolution** | 4K (3840×2160) or 1080p (1920×1080). |
| **Crop Position (Sweet Spot)** | 0% = top of dome, 100% = bottom. Default 30% works for most films. Adjust until your key scene looks right in the preview. |
| **PiP Position** | Choose which corner the circular reference frame appears in. |
| **PiP Size** | Diameter of the PiP in pixels. Default auto-sizes to 480px (4K) or 270px (1080p). |
| **PiP Image Padding** | Distance from the corner in pixels. |
| **Audio** | Downmix to stereo AAC, or passthrough your original audio unchanged. |
| **Quality** | Draft (faster, smaller file) / Standard (balanced) / High (near-lossless). |
| **Output Path** | Defaults to the same folder as your input file. Click Change to override. |

### Building for Distribution

```bash
cd gui && npm run make
```

Produces:
- `dist/*.dmg` — macOS disk image
- `dist/*-setup.exe` — Windows NSIS installer
- `dist/*.AppImage` — Linux portable binary

---

## CLI — Command Line Interface

The CLI (`convert.py`) works independently — no GUI, no Electron, no Node. Useful for batch processing or integration into existing pipelines.

```bash
python convert.py --input film.mp4
```

### All Flags

```
--input         Path to source .mp4 file (required)
--output        Output path (default: <input>_<resolution>_preview.mp4)
--resolution    4k or 1080p (default: 4k)
--sweet-spot    0–100, crop position from top of dome (default: 30)
--pip-size      PiP diameter in pixels (default: 480 for 4K, 270 for 1080p)
--pip-margin    Distance from corner in pixels (default: 40)
--pip-position  br, bl, tr, tl — corner (default: br)
--audio         stereo or passthrough (default: stereo)
--crf           H.264 quality, 0–51 (default: 18; lower = better)
--verbose       Print FFmpeg command and raw output
```

### Examples

```bash
# Standard 4K preview
python convert.py --input my_film.mp4

# 1080p draft for quick sharing
python convert.py --input my_film.mp4 --resolution 1080p --crf 26

# Adjust crop for a film that opens wide
python convert.py --input my_film.mp4 --sweet-spot 20

# Passthrough audio, PiP in bottom-left
python convert.py --input my_film.mp4 --audio passthrough --pip-position bl

# High quality, custom output path
python convert.py --input my_film.mp4 --crf 12 --output /Volumes/Renders/preview.mp4
```

---

## How the Filtergraph Works

For those who want to understand or extend the underlying FFmpeg command:

```
ffmpeg -i input.mp4 -filter_complex \
  "[0:v]scale=OUT_W:OUT_W,crop=OUT_W:OUT_H:0:CROP_OFFSET[bg]; \
   [0:v]scale=PIP:PIP[pip]; \
   [bg][pip]overlay=X:Y" \
  -c:v libx264 -crf CRF -c:a aac -ac 2 output.mp4
```

Where:
- `OUT_W` = 3840 (4K) or 1920 (1080p)
- `OUT_H` = 2160 (4K) or 1080 (1080p)
- `CROP_OFFSET` = `(OUT_W - OUT_H) × (1 - sweet_spot / 100)`
- `PIP` = 480 (4K) or 270 (1080p) by default

---

## Project Status

**v0.2.0** — Production-ready feature set. Bundled FFmpeg, GPU acceleration on all platforms, cross-platform installers via GitHub Actions. Mac builds verified end-to-end; Windows and Linux builds compile in CI but haven't been field-tested yet. See [CHANGELOG.md](CHANGELOG.md) for details.

This is a community project. If you're a fulldome creator, developer, or planetarium professional who wants to help make this better, read [CONTRIBUTING.md](CONTRIBUTING.md).

---

## About Dome Fest West

[Dome Fest West](https://domefestwest.com) is the only dedicated fulldome film festival in the United States — a nonprofit based in Los Angeles with an annual festival and industry expo at Fiske Planetarium, University of Colorado Boulder. Our mission is to advance and elevate immersive experiences globally by supporting fulldome creators, connecting them with venues and audiences, and building the infrastructure the industry needs to grow.

This tool exists because the industry needs it. We're building it in the open so anyone can use it, improve it, or adapt it for their own workflow.

**Questions?** Open an issue or reach out at [domefestwest.com](https://domefestwest.com).

---

## License

MIT — see [LICENSE](LICENSE).

FFmpeg is licensed separately under LGPL/GPL. This tool calls FFmpeg as an external process and does not link against its libraries, which is the simplest approach to LGPL compliance. See [FFmpeg's legal page](https://ffmpeg.org/legal.html) for full details.
