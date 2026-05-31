#!/usr/bin/env python3
"""
Fulldome Preview Converter — CLI
Converts 1:1 fisheye fulldome video or image to 16:9 preview with PiP overlay.

Usage: python convert.py --input <file> [options]
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

SUPPORTED_IMAGE_EXTS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff",
    ".exr", ".dpx", ".tga", ".bmp", ".webp", ".psd",
}

SUPPORTED_VIDEO_EXTS = {
    ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".mxf",
    ".mts", ".m2ts", ".webm", ".flv", ".wmv", ".3gp",
    ".mpg", ".mpeg", ".ts", ".dv",
}

IMAGE_OUTPUT_CODECS = {
    ".png":  ["-codec:v", "png"],
    ".jpg":  ["-codec:v", "mjpeg", "-q:v", "2"],
    ".jpeg": ["-codec:v", "mjpeg", "-q:v", "2"],
    ".tif":  ["-codec:v", "tiff"],
    ".tiff": ["-codec:v", "tiff"],
    ".exr":  ["-codec:v", "exr"],
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
    candidates = [
        Path(__file__).parent / "bin" / "ffmpeg",
        Path(__file__).parent / "bin" / "ffmpeg.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return "ffmpeg"


def probe_duration(input_path: str) -> float | None:
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


def probe_fps(input_path: str) -> str:
    ffprobe = find_ffmpeg().replace("ffmpeg", "ffprobe")
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=r_frame_rate",
             "-of", "default=noprint_wrappers=1:nokey=1", input_path],
            capture_output=True, text=True, timeout=15
        )
        fps = result.stdout.strip()
        return fps if fps else "30/1"
    except Exception:
        return "30/1"


def is_image(path: str) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_IMAGE_EXTS


# ---------------------------------------------------------------------------
# Filtergraph builder
# ---------------------------------------------------------------------------

def build_filtergraph(
    out_width: int,
    out_height: int,
    sweet_spot: int,
    pip_size: int,
    pip_margin: int,
    pip_pos: str,
    scale: float = 1.0,
    h_pan: int = 50,
    pip_enabled: bool = True,
    burnin_title: str | None = None,
    burnin_filename: str | None = None,
    burnin_framenumber: bool = False,
    fps: str = "30/1",
) -> tuple[str, str | None]:
    """
    Build the FFmpeg -filter_complex string.
    Returns (filtergraph_string, output_label_or_None).
    If output_label is not None, caller must pass -map [output_label] to FFmpeg.
    """
    # Scaled square side — applies user scale factor
    scale_dim = round(out_width * scale)

    # Crop offsets: sweet spot controls Y (0%=top of dome, 100%=bottom)
    max_y = scale_dim - out_height
    max_x = scale_dim - out_width
    crop_y = round(max_y * (1 - sweet_spot / 100))
    crop_x = round(max_x * (h_pan / 100)) if max_x > 0 else 0

    # PiP: circular alpha mask via geq
    # \, escapes commas inside geq expressions (FFmpeg filter syntax)
    hs = pip_size / 2
    pip_filter = (
        f"[0:v]scale={pip_size}:{pip_size},"
        f"format=rgba,"
        f"geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':"
        f"a='if(lte(pow(X-{hs}\\,2)+pow(Y-{hs}\\,2)\\,pow({hs}\\,2))\\,255\\,0)'[pip]"
    )

    ox, oy = PIP_POSITIONS[pip_pos]
    ox = ox.format(m=pip_margin)
    oy = oy.format(m=pip_margin)

    bg_filter = (
        f"[0:v]scale={scale_dim}:{scale_dim},"
        f"crop={out_width}:{out_height}:{crop_x}:{crop_y}[bg]"
    )

    drawtext_filters = []
    if burnin_title:
        safe = _esc(burnin_title)
        drawtext_filters.append(
            f"drawtext=text='{safe}':font='Arial':"
            f"fontsize=40:fontcolor=white:borderw=2:bordercolor=black@0.75:"
            f"x=(w-text_w)/2:y=36"
        )
    if burnin_filename:
        safe = _esc(burnin_filename)
        drawtext_filters.append(
            f"drawtext=text='{safe}':font='Arial':"
            f"fontsize=26:fontcolor=white:borderw=2:bordercolor=black@0.75:"
            f"x=20:y=h-text_h-20"
        )
    if burnin_framenumber:
        drawtext_filters.append(
            f"drawtext=text='Frame\\: %{{n}}':font='Arial':"
            f"fontsize=26:fontcolor=white:borderw=2:bordercolor=black@0.75:"
            f"x=w-text_w-20:y=h-text_h-20"
        )

    if pip_enabled:
        parts = [bg_filter, pip_filter]
        if drawtext_filters:
            parts.append(f"[bg][pip]overlay={ox}:{oy}:format=auto[base]")
            cur = "base"
            for i, dt in enumerate(drawtext_filters):
                label = "vout" if i == len(drawtext_filters) - 1 else f"dt{i}"
                parts.append(f"[{cur}]{dt}[{label}]")
                cur = label
            return ";".join(parts), "vout"
        else:
            parts.append(f"[bg][pip]overlay={ox}:{oy}:format=auto")
            return ";".join(parts), None
    else:
        # No PiP — just crop + optional burn-in
        if drawtext_filters:
            parts = [bg_filter]
            cur = "bg"
            for i, dt in enumerate(drawtext_filters):
                label = "vout" if i == len(drawtext_filters) - 1 else f"dt{i}"
                parts.append(f"[{cur}]{dt}[{label}]")
                cur = label
            return ";".join(parts), "vout"
        else:
            return bg_filter, None


def _esc(text: str) -> str:
    """Escape special characters for FFmpeg drawtext."""
    return text.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")


def build_audio_args(mode: str) -> list[str]:
    if mode == "stereo":
        return ["-c:a", "aac", "-ac", "2"]
    return ["-c:a", "copy"]


# ---------------------------------------------------------------------------
# Conversion runner
# ---------------------------------------------------------------------------

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
    bitrate_kbps: int | None = None,
    scale: float = 1.0,
    h_pan: int = 50,
    pip_enabled: bool = True,
    burnin_title: str | None = None,
    burnin_filename: str | None = None,
    burnin_framenumber: bool = False,
    verbose: bool = False,
) -> int:
    res    = RESOLUTIONS[resolution]
    out_w  = res["width"]
    out_h  = res["height"]

    input_is_image  = is_image(input_path)
    output_ext      = Path(output_path).suffix.lower()
    output_is_image = output_ext in IMAGE_OUTPUT_CODECS

    fps = "30/1" if input_is_image else probe_fps(input_path)

    filtergraph, out_label = build_filtergraph(
        out_width          = out_w,
        out_height         = out_h,
        sweet_spot         = sweet_spot,
        pip_size           = pip_size,
        pip_margin         = pip_margin,
        pip_pos            = pip_pos,
        scale              = scale,
        h_pan              = h_pan,
        pip_enabled        = pip_enabled,
        burnin_title       = burnin_title,
        burnin_filename    = burnin_filename,
        burnin_framenumber = burnin_framenumber,
        fps                = fps,
    )

    duration = None if input_is_image else probe_duration(input_path)

    # --- Build FFmpeg command ---
    cmd = [find_ffmpeg(), "-y"]

    if input_is_image:
        cmd += ["-loop", "1"]

    cmd += ["-i", input_path, "-filter_complex", filtergraph]

    if out_label:
        cmd += ["-map", f"[{out_label}]"]

    if output_is_image:
        cmd += IMAGE_OUTPUT_CODECS[output_ext]
        cmd += ["-frames:v", "1"]
    else:
        cmd += ["-c:v", "libx264"]
        if bitrate_kbps:
            cmd += ["-b:v", f"{bitrate_kbps}k"]
        else:
            cmd += ["-crf", str(crf)]

        if not input_is_image and not out_label:
            cmd += build_audio_args(audio)
        elif not input_is_image:
            cmd += ["-map", "0:a?"]
            cmd += build_audio_args(audio)

        if input_is_image:
            cmd += ["-t", "1"]  # 1-second still video

        cmd += ["-progress", "pipe:2"]

    cmd.append(output_path)

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
    if not output_is_image:
        print()

    if proc.returncode != 0:
        print("\n[FFmpeg error output]", file=sys.stderr)
        print("\n".join(error_lines[-40:]), file=sys.stderr)

    return proc.returncode


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv=None) -> argparse.Namespace:
    all_exts = sorted(SUPPORTED_IMAGE_EXTS | SUPPORTED_VIDEO_EXTS)
    p = argparse.ArgumentParser(
        prog="convert.py",
        description="Convert fulldome fisheye video or image to 16:9 preview with PiP overlay.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Supported input formats:
  Video: {' '.join(sorted(SUPPORTED_VIDEO_EXTS))}
  Image: {' '.join(sorted(SUPPORTED_IMAGE_EXTS))}

Examples:
  python convert.py --input film.mp4
  python convert.py --input film.mp4 --resolution 1080p --sweet-spot 30
  python convert.py --input master.exr --output preview.png
  python convert.py --input film.mp4 --scale 1.3 --h-pan 60
  python convert.py --input film.mp4 --burnin-title "My Film" --burnin-framenumber
""",
    )
    p.add_argument("--input",        required=True,
                   help="Path to source file (video or image)")
    p.add_argument("--output",       default=None,
                   help="Output path (default: <input>_<resolution>_preview.<ext>)")
    p.add_argument("--resolution",   default=DEFAULT_RESOLUTION, choices=["4k", "1080p"],
                   help="Output resolution (default: 4k)")
    p.add_argument("--sweet-spot",   type=int, default=DEFAULT_SWEET_SPOT, metavar="0-100",
                   help="Vertical crop: 0%%=top of dome, 100%%=bottom (default: 30)")
    p.add_argument("--scale",        type=float, default=1.0, metavar="1.0-2.0",
                   help="Scale the fisheye before cropping, e.g. 1.3 = 130%% (default: 1.0)")
    p.add_argument("--h-pan",        type=int, default=50, metavar="0-100",
                   help="Horizontal position when scaled: 0%%=left, 100%%=right (default: 50)")
    p.add_argument("--pip-size",     type=int, default=None,
                   help="PiP diameter in pixels (default: auto)")
    p.add_argument("--pip-margin",   type=int, default=DEFAULT_PIP_MARGIN,
                   help="PiP distance from corner in pixels (default: 40)")
    p.add_argument("--pip-position", default=DEFAULT_PIP_POS, choices=["br", "bl", "tr", "tl"],
                   help="PiP corner: br bl tr tl (default: br)")
    p.add_argument("--no-pip", action="store_true",
                   help="Disable the picture-in-picture overlay entirely")
    p.add_argument("--audio",        default=DEFAULT_AUDIO, choices=["stereo", "passthrough"],
                   help="Audio mode for video output (default: stereo)")
    p.add_argument("--crf",          type=int, default=18, metavar="0-51",
                   help="H.264 CRF quality, ignored if --bitrate is set (default: 18)")
    p.add_argument("--bitrate",      type=int, default=None, metavar="KBPS",
                   help="Manual video bitrate in kbps, e.g. 20000 for 20 Mbps")
    p.add_argument("--burnin-title", default=None, metavar="TEXT",
                   help="Burn title text into the top-center of the frame")
    p.add_argument("--burnin-filename", action="store_true",
                   help="Burn the source filename into the bottom-left")
    p.add_argument("--burnin-framenumber", action="store_true",
                   help="Burn the frame number into the bottom-right")
    p.add_argument("--verbose", "-v", action="store_true",
                   help="Print FFmpeg command and raw output")
    return p.parse_args(argv)


def validate_input(path: str) -> None:
    p = Path(path)
    if not p.exists():
        sys.exit(f"Error: input file not found: {path}")
    ext = p.suffix.lower()
    if ext not in SUPPORTED_IMAGE_EXTS and ext not in SUPPORTED_VIDEO_EXTS:
        supported = sorted(SUPPORTED_IMAGE_EXTS | SUPPORTED_VIDEO_EXTS)
        sys.exit(f"Error: unsupported file type '{ext}'. Supported: {', '.join(supported)}")


def default_output(input_path: str, resolution: str) -> str:
    p = Path(input_path)
    if p.suffix.lower() in SUPPORTED_IMAGE_EXTS:
        out_ext = ".png"
    else:
        out_ext = ".mp4"
    return str(p.parent / f"{p.stem}_{resolution}_preview{out_ext}")


def main(argv=None) -> int:
    args = parse_args(argv)

    validate_input(args.input)

    output = args.output or default_output(args.input, args.resolution)
    res    = RESOLUTIONS[args.resolution]
    pip_sz = args.pip_size if args.pip_size is not None else res["pip_size"]

    if not (0 <= args.sweet_spot <= 100):
        sys.exit("Error: --sweet-spot must be between 0 and 100")
    if not (1.0 <= args.scale <= 4.0):
        sys.exit("Error: --scale must be between 1.0 and 4.0")
    if not (0 <= args.h_pan <= 100):
        sys.exit("Error: --h-pan must be between 0 and 100")
    if not (0 <= args.crf <= 51):
        sys.exit("Error: --crf must be between 0 and 51")
    if pip_sz <= 0:
        sys.exit("Error: --pip-size must be a positive integer")
    if args.pip_margin < 0:
        sys.exit("Error: --pip-margin must be non-negative")

    print(f"Input:      {args.input}")
    print(f"Output:     {output}")
    print(f"Resolution: {args.resolution} ({res['width']}×{res['height']})")
    print(f"Sweet spot: {args.sweet_spot}%  Scale: {args.scale:.2f}x  H-pan: {args.h_pan}%")
    pip_on = not args.no_pip
    print(f"PiP:        {'off' if not pip_on else f'{pip_sz}px at {args.pip_position}, margin {args.pip_margin}px'}")
    if not is_image(args.input):
        q = f"manual {args.bitrate} kbps" if args.bitrate else f"CRF {args.crf}"
        print(f"Audio:      {args.audio}  Quality: {q}")
    if args.burnin_title or args.burnin_filename or args.burnin_framenumber:
        items = []
        if args.burnin_title:      items.append(f"title='{args.burnin_title}'")
        if args.burnin_filename:   items.append("filename")
        if args.burnin_framenumber: items.append("frame#")
        print(f"Burn-in:    {', '.join(items)}")
    print()

    rc = run_conversion(
        input_path         = args.input,
        output_path        = output,
        resolution         = args.resolution,
        sweet_spot         = args.sweet_spot,
        pip_size           = pip_sz,
        pip_margin         = args.pip_margin,
        pip_pos            = args.pip_position,
        audio              = args.audio,
        crf                = args.crf,
        bitrate_kbps       = args.bitrate,
        scale              = args.scale,
        h_pan              = args.h_pan,
        pip_enabled        = pip_on,
        burnin_title       = args.burnin_title,
        burnin_filename    = Path(args.input).name if args.burnin_filename else None,
        burnin_framenumber = args.burnin_framenumber,
        verbose            = args.verbose,
    )

    if rc == 0:
        print(f"Done → {output}")
    else:
        print(f"Conversion failed (exit {rc})", file=sys.stderr)

    return rc


if __name__ == "__main__":
    sys.exit(main())
