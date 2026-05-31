# Changelog

All notable changes to the Fulldome Preview Converter are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

Pre-release stages:
- `alpha` — core functionality working, expect bugs, not yet ready for general use
- `beta` — feature-complete, public testing, bugs being resolved
- `1.0.0` — stable, tested on all three platforms, packaged installers available

---

## [0.1.0-alpha.1] — 2026-05-31

First public release. Core conversion pipeline is functional and tested on macOS with real fulldome source files.

### Added

**CLI (`convert.py`)**
- Full FFmpeg filtergraph: fisheye → 16:9 background + circular PiP overlay
- `--input`, `--output`, `--resolution` (4k/1080p), `--sweet-spot` (0–100), `--pip-size`, `--pip-margin`, `--pip-position` (br/bl/tr/tl), `--audio` (stereo/passthrough), `--crf`, `--verbose` flags
- Real-time progress output parsed from FFmpeg's `out_time_ms` stream
- Input validation with clear error messages and exit code 1 on failure
- Friendly error message when FFmpeg is not found, with platform-specific install instructions
- No third-party Python dependencies — standard library only

**GUI (Electron + React)**
- Drag-and-drop file loader; accepts `.mp4`; shows filename and detected resolution
- Live canvas preview — updates instantly as any setting changes
- Frame scrubber — drag a timeline to preview any moment in the film before converting
- "Extracting frame…" loading state with spinner while FFmpeg grabs the preview frame
- Output resolution toggle: 4K / 1080p
- Crop position (sweet spot) slider, 0–100%, default 30%
- PiP position picker — four-corner selector with visual preview
- PiP size slider — 120px to full frame height (2160px / 1080px)
- PiP image padding slider — 0 to 300px
- Audio mode toggle: Downmix to stereo / Passthrough
- Quality toggle: Draft (CRF 26) / Standard (CRF 18) / High (CRF 12)
- Output path control with Change button
- Convert / Cancel button; disabled until valid file is loaded
- Progress bar with elapsed time and estimated time remaining
- Success state with Open File, Show in Finder/Explorer/Folder, and Convert Another buttons
- Error state with scrollable FFmpeg error output
- Overwrite confirmation dialog when output file already exists
- Settings persist between launches via localStorage
- Platform-aware "Show in Finder" / "Show in Explorer" / "Show in Folder" label
- DFW brand colors: orange `#ED8B1E`, gold `#F2C200`, dark theme

### Known Issues

- Windows and Linux untested — expect rough edges, please report
- Pre-built `.dmg` / `.exe` / `.AppImage` installers not yet available; build from source
- Frame scrubber requires FFmpeg on PATH; silent failure if not found
- Very short clips (<5 seconds) fall back to frame 0 for the preview

### Versioning Roadmap

| Version | Stage | Description |
|---------|-------|-------------|
| 0.1.x | Alpha | Core functionality, macOS primary, bug fixes |
| 0.2.x | Alpha | Windows and Linux testing, installer packages |
| 0.3.x | Beta | Public beta, wider testing, community feedback |
| 1.0.0 | Stable | All three platforms tested, packaged installers, docs complete |
