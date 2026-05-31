#!/usr/bin/env python3
"""
Fulldome Preview Converter — CLI
Converts 1:1 fisheye fulldome video to 16:9 preview with PiP overlay.

Usage: python convert.py --input <file.mp4> [options]
Run with --help for full flag documentation.
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RESOLUTIONS = {
    "4k":    {"width": 3840, "height": 2160, "pip_size": 480},
    "1080p": {"width": 1920, "height": 1080, "pip_size": 270},
}

DEFAULT_SWEET_SPOT  = 30
DEFAULT_PIP_MARGIN  = 40
DEFAULT_AUDIO       = "stereo"
DEFAULT_RESOLUTION  = "4k"
DEFAULT_PIP_POS     = "br"

PIP_POSITIONS = {
    "br": ("W-w-{m}", "H-h-{m}"),
    "bl": ("{m}",      "H-h-{m}"),
    "tr": ("W-w-{m}", "{m}"),
    "tl": ("{m}",      "{m}"),
}


# ---------------------------------------------------------------------------
# FFmpeg helpers
# ---------------------------------------------------------------------------

def find_ffmpeg() -> str:
    """Return path to ffmpeg binary (bundled > system PATH)."""
    # When packaged as an Electron app the binary sits next to this script.
    candidates = [
        Path(__file__).parent / "bin" / "ffmpeg",
        Path(__file__).parent / "bin" / "ffmpeg.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return "ffmpeg"  # fall back to system PATH


def probe_duration(input_path: str) -> float | None:
    """Return video duration in seconds using ffprobe, or None on failure."""
    ffprobe = find_ffmpeg().replace("ffmpeg", "ffprobe")
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", input_path],
            capture_output=True, text=True, timeout=15
        )
        return float(result.stdout.strip())
    except Exception:
        return None


def build_filtergraph(
    input_height: int,
    out_width: int,
    out_height: int,
    sweet_spot: int,
    pip_size: int,
    pip_margin: int,
    pip_pos: str,
) -> str:
    """Return the -filter_complex string."""
    # Scale the fisheye to out_width × out_width (square), then crop a 16:9
    # window. Sweet spot 0 = bottom of dome, 100 = top of dome.
    # Valid crop range: 0 .. (scaledSide - out_height).
    scale_dim   = out_width                             # e.g. 3840
    max_offset  = scale_dim - out_height                # e.g. 1680 for 4K
    crop_offset = round(max_offset * (1 - sweet_spot / 100))

    ox, oy = PIP_POSITIONS[pip_pos]
    ox = ox.format(m=pip_margin)
    oy = oy.format(m=pip_margin)

    return (
        f"[0:v]scale={scale_dim}:{scale_dim},"
        f"crop={out_width}:{out_height}:0:{crop_offset}[bg];"
        f"[0:v]scale={pip_size}:{pip_size}[pip];"
        f"[bg][pip]overlay={ox}:{oy}"
    )


def build_audio_args(mode: str) -> list[str]:
    if mode == "stereo":
        return ["-c:a", "aac", "-ac", "2"]
    return ["-c:a", "copy"]  # passthrough


def run_conversion(
    input_path: str,
    output_path: str,
    resolution: str,
    sweet_spot: int,
    pip_size: int,
    pip_margin: int,
    pip_pos: str,
    audio: str,
    crf: int = 18,
    verbose: bool = False,
) -> int:
    """
    Run FFmpeg conversion. Streams stderr to stdout with progress parsing.
    Returns FFmpeg exit code.
    """
    res       = RESOLUTIONS[resolution]
    out_w     = res["width"]
    out_h     = res["height"]

    # Probe source dimensions for crop-offset math.
    probe_cmd = [
        find_ffmpeg().replace("ffmpeg", "ffprobe"),
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=height",
        "-of", "default=noprint_wrappers=1:nokey=1",
        input_path,
    ]
    try:
        src_height = int(subprocess.check_output(probe_cmd, stderr=subprocess.DEVNULL).strip())
    except Exception:
        src_height = out_w  # assume square input if probe fails

    filtergraph = build_filtergraph(
        src_height, out_w, out_h, sweet_spot, pip_size, pip_margin, pip_pos
    )
    audio_args  = build_audio_args(audio)
    duration    = probe_duration(input_path)

    cmd = [
        find_ffmpeg(),
        "-y",
        "-i", input_path,
        "-filter_complex", filtergraph,
        "-c:v", "libx264",
        "-crf", str(crf),
        *audio_args,
        "-progress", "pipe:2",  # machine-readable progress to stderr
        output_path,
    ]

    if verbose:
        print(f"[cmd] {' '.join(cmd)}\n", flush=True)

    try:
        proc = subprocess.Popen(
            cmd,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        bin_name = find_ffmpeg()
        print(
            f"\nError: FFmpeg not found (looked for '{bin_name}').\n"
            "Install it with:  brew install ffmpeg  (macOS)\n"
            "                  choco install ffmpeg  (Windows)\n"
            "                  sudo apt install ffmpeg  (Linux)",
            file=sys.stderr,
        )
        return 1

    error_lines: list[str] = []
    time_re = re.compile(r"out_time_ms=(\d+)")
    last_pct = -1

    for line in proc.stderr:
        line = line.rstrip()
        if verbose:
            print(f"[ffmpeg] {line}", flush=True)

        m = time_re.search(line)
        if m and duration:
            elapsed_s = int(m.group(1)) / 1_000_000
            pct = min(int(elapsed_s / duration * 100), 99)
            if pct != last_pct:
                print(f"\rProgress: {pct}%  ", end="", flush=True)
                last_pct = pct
        elif line and not line.startswith("out_time") and not any(
            line.startswith(k) for k in (
                "frame=", "fps=", "stream_", "bitrate=", "total_size=",
                "out_time_us=", "dup_frames=", "drop_frames=", "speed=",
                "progress=",
            )
        ):
            error_lines.append(line)

    proc.wait()
    print()  # newline after progress

    if proc.returncode != 0:
        print("\n[FFmpeg error output]", file=sys.stderr)
        print("\n".join(error_lines[-40:]), file=sys.stderr)

    return proc.returncode


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="convert.py",
        description="Convert fulldome fisheye video to 16:9 preview with PiP overlay.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python convert.py --input film.mp4
  python convert.py --input film.mp4 --resolution 1080p --sweet-spot 40
  python convert.py --input film.mp4 --audio passthrough --pip-position bl
""",
    )
    p.add_argument("--input",        required=True,  help="Path to source .mp4 file")
    p.add_argument("--output",       default=None,   help="Output path (default: input_preview.mp4)")
    p.add_argument("--resolution",   default=DEFAULT_RESOLUTION, choices=["4k", "1080p"],
                   help="Output resolution (default: 4k)")
    p.add_argument("--sweet-spot",   type=int, default=DEFAULT_SWEET_SPOT, metavar="0-100",
                   help="Vertical crop start as %% of input height (default: 50)")
    p.add_argument("--pip-size",     type=int, default=None,
                   help="PiP diameter in pixels (default: auto)")
    p.add_argument("--pip-margin",   type=int, default=DEFAULT_PIP_MARGIN,
                   help="PiP distance from corner in pixels (default: 40)")
    p.add_argument("--pip-position", default=DEFAULT_PIP_POS, choices=["br", "bl", "tr", "tl"],
                   help="PiP corner: br bl tr tl (default: br)")
    p.add_argument("--audio",        default=DEFAULT_AUDIO, choices=["stereo", "passthrough"],
                   help="Audio mode (default: stereo)")
    p.add_argument("--crf",          type=int, default=18, metavar="0-51",
                   help="H.264 CRF quality (0=lossless, 51=worst; default: 18)")
    p.add_argument("--verbose", "-v", action="store_true", help="Print FFmpeg command and raw output")
    return p.parse_args(argv)


def validate_input(path: str) -> None:
    p = Path(path)
    if not p.exists():
        sys.exit(f"Error: input file not found: {path}")
    if p.suffix.lower() != ".mp4":
        sys.exit(f"Error: input must be an .mp4 file, got: {p.suffix}")


def default_output(input_path: str, resolution: str) -> str:
    p = Path(input_path)
    return str(p.parent / f"{p.stem}_{resolution}_preview.mp4")


def main(argv=None) -> int:
    args = parse_args(argv)

    validate_input(args.input)

    output = args.output or default_output(args.input, args.resolution)
    res    = RESOLUTIONS[args.resolution]
    pip_sz = args.pip_size if args.pip_size is not None else res["pip_size"]

    if not (0 <= args.sweet_spot <= 100):
        sys.exit("Error: --sweet-spot must be between 0 and 100")
    if not (0 <= args.crf <= 51):
        sys.exit("Error: --crf must be between 0 and 51")
    if pip_sz <= 0:
        sys.exit("Error: --pip-size must be a positive integer")
    if args.pip_margin < 0:
        sys.exit("Error: --pip-margin must be non-negative")

    print(f"Input:      {args.input}")
    print(f"Output:     {output}")
    print(f"Resolution: {args.resolution} ({res['width']}×{res['height']})")
    print(f"Sweet spot: {args.sweet_spot}%")
    print(f"PiP:        {pip_sz}px at {args.pip_position}, margin {args.pip_margin}px")
    print(f"Audio:      {args.audio}")
    print(f"Quality:    CRF {args.crf}")
    print()

    rc = run_conversion(
        input_path  = args.input,
        output_path = output,
        resolution  = args.resolution,
        sweet_spot  = args.sweet_spot,
        pip_size    = pip_sz,
        pip_margin  = args.pip_margin,
        pip_pos     = args.pip_position,
        audio       = args.audio,
        crf         = args.crf,
        verbose     = args.verbose,
    )

    if rc == 0:
        print(f"Done → {output}")
    else:
        print(f"Conversion failed (exit {rc})", file=sys.stderr)

    return rc


if __name__ == "__main__":
    sys.exit(main())
