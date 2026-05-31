# Contributing to the Fulldome Preview Converter

First: thank you. This tool exists to help independent fulldome creators, and the people most likely to make it better are the people who actually use it. Whether you're a developer, a filmmaker, or a planetarium professional who just found a bug — you're welcome here.

---

## The Easiest Way to Help Right Now

**Test it on your system and tell us what breaks.**

We built and tested this on macOS. Windows and Linux users: we need you. Run a conversion, try the GUI, push it until something goes wrong, and [open an issue](https://github.com/domefestwest/fulldome-preview-converter/issues/new?template=bug_report.md). Specific beats vague — "it crashed on Windows 11 with an H.265 source file" is more useful than "it doesn't work."

---

## Ways to Contribute

### Report a bug
Open a [bug report](https://github.com/domefestwest/fulldome-preview-converter/issues/new?template=bug_report.md). Include:
- Your OS and version
- FFmpeg version (`ffmpeg -version`)
- What you did, what you expected, what actually happened
- The FFmpeg error output if available (the app shows it on failure)

### Request a feature
Open a [feature request](https://github.com/domefestwest/fulldome-preview-converter/issues/new?template=feature_request.md). Explain your use case — who needs this, what problem it solves, and what the workflow looks like. The more specific you are, the more useful it is.

### Fix a bug or implement a feature
1. Check the [open issues](https://github.com/domefestwest/fulldome-preview-converter/issues) — something you want to work on may already be tracked
2. Comment on the issue to let others know you're picking it up
3. Fork the repo, create a branch (`fix/short-clip-scrubber`, `feature/batch-mode`, etc.)
4. Make your changes
5. Open a pull request against `main`

### Improve the documentation
If something in the README or CHANGELOG is unclear, wrong, or missing — a PR to fix it is always welcome.

---

## Development Setup

### Prerequisites
- Node.js 18+
- Python 3.10+
- FFmpeg installed and on PATH

### Running the GUI in dev mode

```bash
git clone https://github.com/domefestwest/fulldome-preview-converter.git
cd fulldome-preview-converter/gui
npm install
npm run dev   # starts Vite + Electron together
```

### Running the CLI

```bash
cd fulldome-preview-converter
python convert.py --input your_film.mp4 --verbose
```

### Project Structure

```
fulldome-preview-converter/
  convert.py          # Python CLI — the core conversion engine
  requirements.txt    # No third-party deps; documents that intentionally
  gui/
    main.js           # Electron main process — all FFmpeg subprocess calls live here
    preload.js        # Secure contextBridge between main and renderer
    vite.config.js    # Vite build config
    src/
      App.jsx         # Root React component, state management
      components/
        DropZone.jsx         # File input
        Preview.jsx          # Live canvas preview + scrubber
        ToggleGroup.jsx      # Button group control
        Slider.jsx           # Styled range input
        PipPositionPicker.jsx
        ProgressBar.jsx
```

### Architecture Principles

**All FFmpeg subprocess calls happen in `main.js`.** Never call FFmpeg or spawn child processes from the React renderer. Communication between main and renderer goes through IPC (`ipcMain` / `ipcRenderer` via the preload bridge).

**The CLI is independent.** `convert.py` must work without the GUI — no Electron, no Node, no imports beyond the Python standard library.

**The live preview is canvas-only.** After loading a frame from FFmpeg, all setting changes update a `<canvas>` element in real time without any additional FFmpeg calls. Only scrubbing to a new time triggers a new frame extraction.

---

## Pull Request Guidelines

- Keep PRs focused — one thing per PR is easier to review
- If you're fixing a bug, describe what caused it and how the fix addresses it
- If you're adding a feature, reference the issue it closes
- The CLI and GUI must stay in sync — if you change filtergraph math in `convert.py`, update `Preview.jsx` to match

---

## Code of Conduct

Be excellent to each other. This is a tool for a community of artists and storytellers. Treat everyone — regardless of technical experience, background, or how they make their films — with respect. DFW is an inclusive organization and this project reflects that.

---

## Questions?

Open an issue or reach out through [domefestwest.com](https://domefestwest.com). We're a small team (very small — often one person), so response time may vary, but we read everything.
