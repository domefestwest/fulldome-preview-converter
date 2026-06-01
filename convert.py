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

# Base pip sizes keyed by shorter dimension
PIP_SIZES = {
    2160: 480,
    1080: 270,
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
DEFAULT_CROP_MODE   = "16:9"

PIP_POSITIONS = {
    "br": ("W-w-{m}", "H-h-{m}"),
    "bl": ("{m}",      "H-h-{m}"),
    "tr": ("W-w-{m}", "{m}"),
    "tl": ("{m}",      "{m}"),
}

WM_POSITIONS = {
    "br": ("W-w-{m}", "H-h-{m}"),
    "bl": ("{m}",     "H-h-{m}"),
    "tr": ("W-w-{m}", "{m}"),
    "tl": ("{m}",      "{m}"),
}


# ---------------------------------------------------------------------------
# Output dimension helper
# ---------------------------------------------------------------------------

def get_output_dims(resolution: str, crop_mode: str) -> tuple[int, int]:
    """Return (width, height) for the given resolution and crop mode."""
    base = 2160 if resolution == "4k" else 1080
    if crop_mode == "16:9":
        return (base * 16 // 9, base)
    elif crop_mode == "9:16":
        return (base, base * 16 // 9)
    else:  # 1:1
        return (base, base)


def get_pip_size(resolution: str) -> int:
    base = 2160 if resolution == "4k" else 1080
    return PIP_SIZES.get(base, 270)


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


def find_ffprobe() -> str:
    """Locate ffprobe alongside ffmpeg — handles .exe suffix on Windows."""
    candidates = [
        Path(__file__).parent / "bin" / "ffprobe",
        Path(__file__).parent / "bin" / "ffprobe.exe",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return "ffprobe"


# ---------------------------------------------------------------------------
# Hardware encoder detection
# ---------------------------------------------------------------------------

# Priority order: best GPU encoders first, software last
HW_ENCODER_PRIORITY = [
    "h264_videotoolbox",   # macOS (Apple Silicon + Intel) — always available on Mac
    "h264_nvenc",          # NVIDIA (Windows / Linux)
    "h264_amf",            # AMD (Windows)
    "h264_qsv",            # Intel Quick Sync (Windows / Linux)
    "libx264",             # software fallback
]

# Module-level cache so we only probe once per process
_encoder_cache: str | None = None


def detect_best_encoder(ffmpeg: str) -> str:
    """Return the best available H.264 encoder. Result is cached per process."""
    global _encoder_cache
    if _encoder_cache is not None:
        return _encoder_cache

    # Get list of compiled-in encoders
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=10
        )
        compiled = result.stdout
    except Exception:
        _encoder_cache = "libx264"
        return _encoder_cache

    # Test each candidate in priority order
    for enc in HW_ENCODER_PRIORITY:
        if enc not in compiled:
            continue
        if enc == "libx264":
            # Software encoder is always usable if compiled in
            _encoder_cache = "libx264"
            return _encoder_cache
        # Verify the hardware encoder actually works with a tiny test encode
        null_out = "NUL" if sys.platform == "win32" else "-"
        try:
            test = subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error",
                 "-f", "lavfi", "-i", "color=black:s=64x64:d=0.04",
                 "-c:v", enc, "-f", "null", null_out],
                capture_output=True, timeout=10
            )
            if test.returncode == 0:
                _encoder_cache = enc
                return _encoder_cache
        except Exception:
            continue

    _encoder_cache = "libx264"
    return _encoder_cache


def build_encoder_args(
    encoder: str,
    crf: int,
    bitrate_kbps: int | None,
) -> list[str]:
    """
    Return FFmpeg encoder CLI args for the given encoder and quality setting.
    Each hardware encoder uses its own quality parameter equivalent to libx264 CRF.
    """
    # Always start with pixel format for compatibility
    args = ["-pix_fmt", "yuv420p"]

    if bitrate_kbps:
        # Bitrate mode: works the same across all encoders
        args += ["-c:v", encoder, "-b:v", f"{bitrate_kbps}k"]
        if encoder == "h264_nvenc":
            args += ["-preset", "p4"]
        elif encoder == "h264_videotoolbox":
            args += ["-allow_sw", "1"]
        return args

    # Constant-quality mode — encoder-specific parameter
    if encoder == "h264_videotoolbox":
        # VideoToolbox uses -q:v 1-100 (100=best). Map CRF linearly:
        #   CRF 0  → q:v 100,  CRF 18 → q:v 65,  CRF 26 → q:v 50,  CRF 51 → q:v 1
        q = max(1, min(100, round(100 - crf * 1.94)))
        args += ["-c:v", encoder, "-q:v", str(q), "-allow_sw", "1"]

    elif encoder == "h264_nvenc":
        # NVENC uses -cq (constant quality, same 0-51 range as CRF)
        args += ["-c:v", encoder, "-preset", "p4", "-rc", "vbr", "-cq", str(crf)]

    elif encoder == "h264_amf":
        # AMF uses constant QP mode
        args += ["-c:v", encoder, "-quality", "quality",
                 "-rc", "cqp", "-qp_i", str(crf), "-qp_p", str(crf)]

    elif encoder == "h264_qsv":
        # QSV uses -global_quality (same range as CRF)
        args += ["-c:v", encoder, "-preset", "medium", "-global_quality", str(crf)]

    else:
        # libx264 software
        args += ["-c:v", "libx264", "-crf", str(crf)]

    return args


def probe_duration(input_path: str) -> float | None:
    ffprobe = find_ffprobe()
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
    ffprobe = find_ffprobe()
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
    burnin_corner: str = "bl",
    fps: str = "30/1",
    slate_title: str | None = None,
    slate_creator: str | None = None,
    slate_year: str | None = None,
    watermark_path: str | None = None,
    watermark_corner: str = "br",
    watermark_opacity: int = 80,
    watermark_size: int = 15,
    watermark_input_index: int = 1,
) -> tuple[str, str | None]:
    """
    Build the FFmpeg -filter_complex string.
    Returns (filtergraph_string, output_label_or_None).
    If output_label is not None, caller must pass -map [output_label] to FFmpeg.
    """
    # For 9:16 and 1:1 crop modes out_width may equal or be less than out_height.
    # The fisheye source is square; scale_dim is based on the LARGER of out_w/out_h
    # so we always have enough source pixels to fill the output frame.
    base_dim = max(out_width, out_height)
    scale_dim = round(base_dim * scale)

    # Crop offsets: sweet spot controls Y (0%=top of dome, 100%=bottom)
    max_y = scale_dim - out_height
    max_x = scale_dim - out_width
    crop_y = round(max_y * (1 - sweet_spot / 100)) if max_y > 0 else 0
    crop_x = round(max_x * (h_pan / 100)) if max_x > 0 else 0

    # PiP: circular alpha mask via geq
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

    # Build burn-in items
    burnin_items = []
    if burnin_title:       burnin_items.append(("text", _esc(burnin_title)))
    if burnin_filename:    burnin_items.append(("text", _esc(burnin_filename)))
    if burnin_framenumber: burnin_items.append(("framenumber", None))

    x_expr = "20" if burnin_corner == "bl" else "w-text_w-20"
    fontsize = 28

    drawtext_filters = []
    for i, (kind, val) in enumerate(burnin_items):
        y_offset = 20 + (len(burnin_items) - 1 - i) * (fontsize + 14)
        y_expr = f"h-text_h-{y_offset}"
        text_expr = f"'Frame\\: %{{n}}'" if kind == "framenumber" else f"'{val}'"
        drawtext_filters.append(
            f"drawtext=text={text_expr}:font='Arial':"
            f"fontsize={fontsize}:fontcolor=white:borderw=2:bordercolor=black@0.75:"
            f"x={x_expr}:y={y_expr}"
        )

    # Build main video chain
    if pip_enabled:
        parts = [bg_filter, pip_filter]
        if drawtext_filters:
            parts.append(f"[bg][pip]overlay={ox}:{oy}:format=auto[base]")
            cur = "base"
            for i, dt in enumerate(drawtext_filters):
                label = f"dt{i}"
                parts.append(f"[{cur}]{dt}[{label}]")
                cur = label
        else:
            parts.append(f"[bg][pip]overlay={ox}:{oy}:format=auto[base]")
            cur = "base"
    else:
        # No PiP
        if drawtext_filters:
            parts = [bg_filter]
            cur = "bg"
            for i, dt in enumerate(drawtext_filters):
                label = f"dt{i}"
                parts.append(f"[{cur}]{dt}[{label}]")
                cur = label
        else:
            # Simple path — no labels needed unless we have slate/watermark downstream
            parts = [
                f"[0:v]scale={scale_dim}:{scale_dim},"
                f"crop={out_width}:{out_height}:{crop_x}:{crop_y}[base]"
            ]
            cur = "base"

    # Slate bar
    has_slate = any([slate_title, slate_creator, slate_year])
    if has_slate:
        bar_h = round(out_height * 0.10)
        # pad video to add black bar at bottom
        parts.append(f"[{cur}]pad={out_width}:{out_height + bar_h}:0:0:black[slated]")
        cur = "slated"
        # Title centered
        if slate_title:
            parts.append(
                f"[{cur}]drawtext=text='{_esc(slate_title)}':font='Arial':"
                f"fontsize=36:fontcolor=white:borderw=2:bordercolor=black@0.6:"
                f"x=(w-text_w)/2:y={out_height}+({bar_h}-text_h)/2[slate0]"
            )
            cur = "slate0"
        # Creator bottom-left of bar
        if slate_creator:
            parts.append(
                f"[{cur}]drawtext=text='{_esc(slate_creator)}':font='Arial':"
                f"fontsize=24:fontcolor=rgba(255,255,255,0.7):borderw=1:bordercolor=black@0.5:"
                f"x=20:y={out_height}+{bar_h}-text_h-10[slate1]"
            )
            cur = "slate1"
        # Year bottom-right of bar
        if slate_year:
            parts.append(
                f"[{cur}]drawtext=text='{_esc(slate_year)}':font='Arial':"
                f"fontsize=24:fontcolor=rgba(255,255,255,0.7):borderw=1:bordercolor=black@0.5:"
                f"x=w-text_w-20:y={out_height}+{bar_h}-text_h-10[slate2]"
            )
            cur = "slate2"

    # Watermark overlay
    if watermark_path:
        wm_idx = watermark_input_index
        margin = 20
        ox_wm, oy_wm = WM_POSITIONS[watermark_corner]
        ox_wm = ox_wm.format(m=margin)
        oy_wm = oy_wm.format(m=margin)
        opacity_f = watermark_opacity / 100.0
        parts.append(
            f"[{wm_idx}:v]scale=round({out_width}*{watermark_size}/100):-1:flags=lanczos,"
            f"format=rgba,colorchannelmixer=aa={opacity_f:.3f}[wm]"
        )
        parts.append(f"[{cur}][wm]overlay={ox_wm}:{oy_wm}:format=auto[wmout]")
        cur = "wmout"

    # Determine final label
    # If cur is still "base" and it came from the simple no-pip/no-burnin path,
    # we need to check: the simple path already set a [base] label.
    # If nothing changed cur from "base", we have [base] already labelled.
    # But the very simple path (no pip, no burnin, no slate, no watermark) should
    # return None label for backwards compat. Check that:
    has_label = not (
        not pip_enabled
        and not drawtext_filters
        and not has_slate
        and not watermark_path
    )

    if not has_label:
        # rewrite the simple path to NOT use labels
        return (
            f"[0:v]scale={scale_dim}:{scale_dim},"
            f"crop={out_width}:{out_height}:{crop_x}:{crop_y}"
        ), None

    return ";".join(parts), cur


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
    burnin_corner: str = "bl",
    verbose: bool = False,
    crop_mode: str = "16:9",
    trim_start: float = 0.0,
    trim_end: float | None = None,
    slate_title: str | None = None,
    slate_creator: str | None = None,
    slate_year: str | None = None,
    watermark_path: str | None = None,
    watermark_corner: str = "br",
    watermark_opacity: int = 80,
    watermark_size: int = 15,
    hw_accel: bool = True,
) -> int:
    out_w, out_h = get_output_dims(resolution, crop_mode)

    input_is_image  = is_image(input_path)
    output_ext      = Path(output_path).suffix.lower()
    output_is_image = output_ext in IMAGE_OUTPUT_CODECS

    fps = "30/1" if input_is_image else probe_fps(input_path)

    # Determine watermark input index (1 if watermark present, else unused)
    watermark_input_index = 1 if watermark_path else 0

    filtergraph, out_label = build_filtergraph(
        out_width              = out_w,
        out_height             = out_h,
        sweet_spot             = sweet_spot,
        pip_size               = pip_size,
        pip_margin             = pip_margin,
        pip_pos                = pip_pos,
        scale                  = scale,
        h_pan                  = h_pan,
        pip_enabled            = pip_enabled,
        burnin_title           = burnin_title,
        burnin_filename        = burnin_filename,
        burnin_framenumber     = burnin_framenumber,
        burnin_corner          = burnin_corner,
        fps                    = fps,
        slate_title            = slate_title,
        slate_creator          = slate_creator,
        slate_year             = slate_year,
        watermark_path         = watermark_path,
        watermark_corner       = watermark_corner,
        watermark_opacity      = watermark_opacity,
        watermark_size         = watermark_size,
        watermark_input_index  = watermark_input_index,
    )

    # Effective duration for progress tracking
    duration = None
    if not input_is_image:
        raw_dur = probe_duration(input_path)
        if raw_dur:
            t_start = trim_start or 0.0
            if trim_end and trim_end > t_start:
                duration = trim_end - t_start
            else:
                duration = raw_dur - t_start

    # --- Build FFmpeg command ---
    cmd = [find_ffmpeg(), "-y"]

    if input_is_image:
        cmd += ["-loop", "1"]

    # Trim start: seek BEFORE input for fast seeking
    if not input_is_image and trim_start and trim_start > 0:
        cmd += ["-ss", str(trim_start)]

    cmd += ["-i", input_path]

    # Watermark input
    if watermark_path:
        cmd += ["-i", watermark_path]

    cmd += ["-filter_complex", filtergraph]

    if out_label:
        cmd += ["-map", f"[{out_label}]"]

    if output_is_image:
        cmd += IMAGE_OUTPUT_CODECS[output_ext]
        cmd += ["-frames:v", "1"]
    else:
        # Trim end: duration limit AFTER input
        if not input_is_image and trim_end and trim_end > (trim_start or 0.0):
            cmd += ["-t", str(trim_end - (trim_start or 0.0))]

        # Select encoder: GPU if available and requested, else software
        ffmpeg_bin = find_ffmpeg()
        if hw_accel:
            encoder = detect_best_encoder(ffmpeg_bin)
        else:
            encoder = "libx264"

        cmd += build_encoder_args(encoder, crf, bitrate_kbps)

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
        line = line.rstrip().replace("\r", "")  # strip \r for Windows FFmpeg output
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
        description="Convert fulldome fisheye video or image to preview with PiP overlay.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Supported input formats:
  Video: {' '.join(sorted(SUPPORTED_VIDEO_EXTS))}
  Image: {' '.join(sorted(SUPPORTED_IMAGE_EXTS))}

Examples:
  python convert.py --input film.mp4
  python convert.py --input film.mp4 --resolution 1080p --sweet-spot 30
  python convert.py --input film.mp4 --crop-mode 9:16
  python convert.py --input master.exr --output preview.png
  python convert.py --input film.mp4 --scale 1.3 --h-pan 60
  python convert.py --input film.mp4 --burnin-title "My Film" --burnin-framenumber
  python convert.py --input film.mp4 --trim-start 10 --trim-end 60
  python convert.py --input film.mp4 --slate-title "My Film" --slate-creator "Director"
  python convert.py --input film.mp4 --watermark logo.png --watermark-corner br
""",
    )
    p.add_argument("--input",        required=True,
                   help="Path to source file (video or image)")
    p.add_argument("--output",       default=None,
                   help="Output path (default: <input>_<resolution>_preview.<ext>)")
    p.add_argument("--resolution",   default=DEFAULT_RESOLUTION, choices=["4k", "1080p"],
                   help="Output resolution (default: 4k)")
    p.add_argument("--crop-mode",    default=DEFAULT_CROP_MODE, choices=["16:9", "9:16", "1:1"],
                   help="Output aspect ratio (default: 16:9)")
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
                   help="Burn title text into the frame")
    p.add_argument("--burnin-filename", action="store_true",
                   help="Burn the source filename into the frame")
    p.add_argument("--burnin-framenumber", action="store_true",
                   help="Burn the frame number into the frame")
    p.add_argument("--burnin-corner", default="bl", choices=["bl", "br"],
                   help="Corner for all burn-in overlays: bl=bottom-left, br=bottom-right (default: bl)")
    p.add_argument("--trim-start",   type=float, default=0.0, metavar="SECONDS",
                   help="Start time in seconds (default: 0)")
    p.add_argument("--trim-end",     type=float, default=None, metavar="SECONDS",
                   help="End time in seconds (default: full duration)")
    p.add_argument("--slate-title",  default=None, metavar="TEXT",
                   help="Add a slate bar with this title below the video")
    p.add_argument("--slate-creator", default=None, metavar="TEXT",
                   help="Creator name in slate bar")
    p.add_argument("--slate-year",   default=None, metavar="YEAR",
                   help="Year in slate bar")
    p.add_argument("--watermark",    default=None, metavar="PATH",
                   help="Path to watermark PNG/SVG file")
    p.add_argument("--watermark-corner", default="br", choices=["br", "bl", "tr", "tl"],
                   help="Corner for watermark overlay (default: br)")
    p.add_argument("--watermark-opacity", type=int, default=80, metavar="0-100",
                   help="Watermark opacity 0-100 (default: 80)")
    p.add_argument("--watermark-size", type=int, default=15, metavar="PCT",
                   help="Watermark width as %% of output width (default: 15)")
    p.add_argument("--no-hw-accel", action="store_true",
                   help="Force software (libx264) encoding, disabling GPU acceleration")
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


def default_output(input_path: str, resolution: str, crop_mode: str = "16:9") -> str:
    p = Path(input_path)
    cm_tag = crop_mode.replace(":", "x")
    if p.suffix.lower() in SUPPORTED_IMAGE_EXTS:
        out_ext = ".png"
    else:
        out_ext = ".mp4"
    return str(p.parent / f"{p.stem}_{resolution}_{cm_tag}_preview{out_ext}")


def main(argv=None) -> int:
    args = parse_args(argv)

    validate_input(args.input)

    output = args.output or default_output(args.input, args.resolution, args.crop_mode)
    out_w, out_h = get_output_dims(args.resolution, args.crop_mode)
    pip_sz = args.pip_size if args.pip_size is not None else get_pip_size(args.resolution)

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

    hw_accel = not args.no_hw_accel
    encoder = detect_best_encoder(find_ffmpeg()) if hw_accel else "libx264"
    hw_label = f"{encoder} (GPU)" if encoder != "libx264" else "libx264 (CPU)"

    print(f"Input:      {args.input}")
    print(f"Output:     {output}")
    print(f"Resolution: {args.resolution} ({out_w}×{out_h})  Crop: {args.crop_mode}")
    print(f"Encoder:    {hw_label}")
    print(f"Sweet spot: {args.sweet_spot}%  Scale: {args.scale:.2f}x  H-pan: {args.h_pan}%")
    pip_on = not args.no_pip
    print(f"PiP:        {'off' if not pip_on else f'{pip_sz}px at {args.pip_position}, margin {args.pip_margin}px'}")
    if not is_image(args.input):
        q = f"manual {args.bitrate} kbps" if args.bitrate else f"CRF {args.crf}"
        print(f"Audio:      {args.audio}  Quality: {q}")
        if args.trim_start or args.trim_end:
            print(f"Trim:       {args.trim_start}s → {args.trim_end or 'end'}")
    if args.burnin_title or args.burnin_filename or args.burnin_framenumber:
        items = []
        if args.burnin_title:      items.append(f"title='{args.burnin_title}'")
        if args.burnin_filename:   items.append("filename")
        if args.burnin_framenumber: items.append("frame#")
        print(f"Burn-in:    {', '.join(items)}")
    if args.slate_title or args.slate_creator or args.slate_year:
        print(f"Slate:      title='{args.slate_title}' creator='{args.slate_creator}' year='{args.slate_year}'")
    if args.watermark:
        print(f"Watermark:  {args.watermark} at {args.watermark_corner}, {args.watermark_size}% wide, {args.watermark_opacity}% opacity")
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
        burnin_corner      = args.burnin_corner,
        verbose            = args.verbose,
        crop_mode          = args.crop_mode,
        trim_start         = args.trim_start,
        trim_end           = args.trim_end,
        slate_title        = args.slate_title,
        slate_creator      = args.slate_creator,
        slate_year         = args.slate_year,
        watermark_path     = args.watermark,
        watermark_corner   = args.watermark_corner,
        watermark_opacity  = args.watermark_opacity,
        watermark_size     = args.watermark_size,
        hw_accel           = hw_accel,
    )

    if rc == 0:
        print(f"Done → {output}")
    else:
        print(f"Conversion failed (exit {rc})", file=sys.stderr)

    return rc


if __name__ == "__main__":
    sys.exit(main())
