# Fulldome Preview Converter

**Turn your dome master into a sales asset in under five minutes.**

*A free tool from [Dome Fest West](https://domefestwest.com), built for fulldome creators, planetarium producers, and immersive content studios.*

---

## Your work deserves an audience. This helps you find one.

You made something extraordinary. A film designed to fill a dome — 360 degrees, fully immersive, the kind of experience that changes how someone sees the world.

But you can't put a dome inside an email. You can't drop a fisheye master into a Vimeo upload. You can't post a 1:1 circle to Instagram and expect a sponsor to imagine what it looks like at Fiske, or Adler, or the Hayden.

So your finished film sits in a folder. Festivals don't see it. Venues don't book it. Sponsors don't fund the next one.

**This tool exists to fix that.**

Drag your dome master in. Pick the format your audience uses — a horizontal preview for Vimeo, a vertical clip for Reels, a square for your Instagram feed. Add your title, your studio name, your year. Watch the live preview update as you tweak. Hit Convert.

Five minutes later, you've got a sales-ready file you can send to a festival, embed in a sponsor deck, post to YouTube, or DM to the curator at the planetarium you want to play in next.

---

## What you can make with it

Every output is something your audience can actually watch on the device they're already holding.

### Marketing previews
- **YouTube / Vimeo trailer** — full 16:9, with your title card, your name, and a circular reference frame in the corner so viewers understand the dome format
- **Instagram Reels & TikTok teaser** — 9:16 vertical crop, trimmed to a 30-second highlight, with your logo watermarked in the corner
- **Instagram feed clip** — 1:1 square, perfect for the grid
- **Sponsor pitch deck embed** — high-quality 1080p with audio normalized to streaming standards so it plays cleanly inside Keynote, PowerPoint, or Google Slides

### Festival deliverables
- **Festival submission preview** — 4K, with a letterbox slate bar containing title, creator, and year burned in
- **Festival jury screener** — color-tagged for accurate playback in QuickTime, Premiere, or whatever the jury opens it in
- **Loudness-compliant audio** — one-click -23 LUFS for broadcast/festival, or -14 LUFS for streaming platforms

### Press kits & EPKs
- **Batch convert a whole press kit** — drop in 10 stills and 3 clips from your project, hit Convert All, walk away
- **Frame grabs for press** — automatic poster JPG saved alongside every video
- **Watermarked previews** — your studio logo subtly placed in the corner so files shared with press still credit you

---

## Why fulldome creators use it

**Made by people who actually run a festival.** [Dome Fest West](https://domefestwest.com) is a working fulldome festival. We sat through hundreds of submissions, watched creators struggle with the same conversion problem, and built this tool because the industry needed it.

**No subscription, no render farm, no post house.** Everything runs locally on your laptop. Free forever, MIT licensed. You own the output.

**Fast.** GPU-accelerated on every platform — Apple Silicon, Intel, NVIDIA, AMD, and Linux integrated graphics. A 4-minute fulldome film at 4K converts in under a minute on a modern Mac. Without GPU, it still works — just slower.

**Knows the format.** This isn't a generic video converter. It understands what a dome master is. The sweet-spot control lets you point the camera at the part of the dome your audience needs to see. The PiP overlay tells the viewer they're looking at an immersive piece without you having to explain it in your caption.

**Sales-ready out of the box.** Slate bars, watermarks, color tagging, audio normalization, social-platform duration warnings — all the finishing touches that separate a sales asset from a "raw render" are one click away.

---

## Download

Grab the installer for your computer:

| Your computer | Download |
|----------|------|
| **Mac (M1/M2/M3 — most Macs sold in the last 4 years)** | [`-arm64.dmg`](https://github.com/domefestwest/fulldome-preview-converter/releases) |
| **Mac (Intel — older Macs)** | [`.dmg`](https://github.com/domefestwest/fulldome-preview-converter/releases) |
| **Windows 10 or 11** | [`.exe`](https://github.com/domefestwest/fulldome-preview-converter/releases) |
| **Linux** | [`.AppImage`](https://github.com/domefestwest/fulldome-preview-converter/releases) |

Everything's bundled inside the installer — FFmpeg, fonts, all the under-the-hood machinery. The only thing you need on your computer is Python 3.10 or newer (most modern computers already have it).

> **First-launch heads-up.** This is a brand-new tool from a small nonprofit, and we haven't paid for the expensive code-signing certificates that big companies use yet. On a Mac, you'll see "this app is from an unidentified developer" the first time — right-click the app, choose Open, then click Open Anyway. On Windows, you'll see a SmartScreen warning — click "More info," then "Run anyway." This only happens once.

---

## Inside the app

A quick walkthrough of what you'll see when you open it.

### Drop your file
The big drop zone in the middle accepts any dome master format you've got — MP4, MOV, MKV from a render, or EXR / TIFF / DPX stills from a frame sequence. Drag it in. You'll see your first frame within a couple seconds.

### Pick your output format
Above the settings panel, three buttons: **16:9 Widescreen**, **9:16 Vertical**, **1:1 Square**. This is the single most important choice — it changes the entire output shape and how the dome image gets cropped to fit.

### Frame your dome
The **Background Image** tab is where you tell the converter which part of the dome to show.

- **Vertical Position** — slide between top of the dome (zenith) and bottom (horizon). Most films sit nicely at 30%.
- **Horizontal Position** — when you're zoomed in, this pans left-right. Center is 50%.
- **Scale** — zoom into the dome image to fill black corners or focus on a specific area.

The preview updates live as you slide. What you see is what you'll get.

### Add the picture-in-picture
The **Picture-in-Picture** tab puts a small circular copy of the full dome in a corner of your output. Viewers see your cropped 16:9 preview AND understand it's an immersive piece. Pick a corner, set the size, set the padding.

You can turn this off entirely if you'd rather have a clean 16:9 with no overlay.

### Polish for delivery
The **Export** tab is where the marketing magic happens.

- **Quality** — Draft for quick sharing, Standard for most uses, High for archival or festival masters.
- **Burn-in overlays** — title text, filename, frame number — in either bottom corner.
- **Slate bar** — adds a black letterbox bar below the video with your title, your name, and your year. Looks like a broadcast deliverable.
- **Watermark** — drop in your studio logo as a PNG, choose the corner and opacity.
- **Color space (Rec.709)** — prevents your video from looking washed out when someone opens it in Premiere or QuickTime.
- **Audio normalization** — one click for festival-spec loudness (-23 LUFS) or streaming-spec (-14 LUFS).

### Save your settings as a preset
Configure once, save as a named preset, load it next time. Three built-in presets cover the most common workflows:

- **🌟 Quick Teaser** — 9:16 vertical, trimmed to 30 seconds, slate ready
- **🌟 Festival Submission** — 4K widescreen, high quality, color-tagged, loudness-normalized for festival delivery
- **🌟 Social Reels** — 9:16, manual bitrate, streaming-spec audio

### Hit Convert
You'll see a progress bar with a time estimate. When it's done, you can:

- **Open the file** in your default video player to review
- **Show in Finder / File Explorer** to grab it for upload
- **Drag the success card** directly into Slack, an email, or your editor
- **Get a system notification** when conversion finishes (useful for long files)

---

## Built for different workflows

### For festival submitters
Use the **Festival Submission** preset as a starting point. The slate bar gives your submission that broadcast-deliverable polish jurors expect. Color tagging means whoever opens your file sees the colors you actually graded. The -23 LUFS loudness normalization meets the audio specs most festivals require. Watch for the **platform duration warning** chip — if your trim exceeds a target festival's runtime limit, you'll see it before you encode.

### For planetarium marketing teams
You've got a season of shows to promote and a small team. Batch mode lets you drop in every show trailer at once, hit Convert All, and walk away. Use a preset with your venue's logo as the watermark and your slate format dialed in — every output becomes consistent without manual setup. The 9:16 format is a goldmine for Instagram Reels promoting upcoming shows.

### For indie creators selling to venues
Your pitch is everything. The **Sponsor Pitch Deck** workflow: 1080p, slate bar with your name and year, watermark with your studio logo, color tagged for accurate playback inside Keynote and PowerPoint. Plus a poster JPG export checkbox so you have a thumbnail for the deck cover slide.

### For studios with multiple deliverables per project
A single source dome master often needs to ship as: festival 4K, Vimeo 1080p, Instagram Reels 9:16, Instagram feed 1:1, press kit thumbnail. Save each as a preset, batch-convert in a single session. Use the filename template ({filename}_{cropmode}_{resolution}) so every output is automatically named for its destination.

### For educators and museum content producers
Most of the same workflows apply — you usually need a sample to send to administrators, a clip for the museum's website, and a teaser for social. The **Quick Teaser** preset is designed for exactly this.

---

## Frequently asked

**My render is 8K — will it work?**
Yes. The output downscales to 4K or 1080p. Source files can be any resolution.

**My render is a frame sequence (EXR / DPX / TIFF) — will it work?**
Yes. Drop in any single frame and you'll get a still preview at your chosen format. For a video preview from a frame sequence, render it to MOV or MP4 first in After Effects, Resolve, or Premiere, then convert.

**Does it preserve my audio?**
Yes. By default it downmixes to stereo AAC for broad compatibility. You can switch to passthrough mode to keep your original audio track untouched. If you turn on loudness normalization, audio is re-encoded to meet the chosen spec.

**Will it bake in my logo?**
Yes — add a PNG logo as a watermark. You control corner, opacity, and size.

**Can I trim to just a 30-second highlight?**
Yes. The trim controls let you set in and out points on the timeline. Combined with the **Test Render** button (5-second sample at current settings), you can dial in exactly the right window before encoding the full thing.

**Will my colors look right when someone opens the file?**
Yes — turn on **Color space (Rec.709)** in the Export tab and the output gets the right metadata tags. This prevents the washed-out look you sometimes get when a video plays back in Premiere, QuickTime, or VLC.

**How big will the output file be?**
The app shows a live size estimate next to the Convert button based on your current settings. For typical 4K 4-minute fulldome films at standard quality, expect 200–400 MB. At draft quality, 50–150 MB.

**How long does conversion take?**
On a modern Mac with GPU acceleration on (default), about half the duration of your source file. A 4-minute fulldome master converts in roughly two minutes. On Windows/Linux with NVIDIA, AMD, or Intel GPUs, similar speeds. On CPU-only, expect 2-4× the source duration.

**My computer doesn't have a GPU — will it still work?**
Yes. The app automatically falls back to CPU encoding. It's slower but the output is identical.

**Does it work offline?**
Yes, entirely. Nothing is uploaded, nothing is sent to a cloud service. Your files stay on your computer.

**Will my client / festival / venue / sponsor know I used this tool?**
No. The output is a standard MP4 with no watermarks or branding (unless you add your own watermark, which is the point).

**Can I use this for commercial projects?**
Yes. MIT licensed, no commercial restrictions. The output is yours.

---

## About Dome Fest West

[Dome Fest West](https://domefestwest.com) is the only dedicated fulldome film festival in the United States — a nonprofit based in Los Angeles with an annual festival and industry expo at Fiske Planetarium, University of Colorado Boulder.

Our mission is to advance and elevate immersive experiences globally by supporting fulldome creators, connecting them with venues and audiences, and building the infrastructure the industry needs to grow.

This tool exists because the industry needs it. We're building it in the open so anyone can use it, improve it, or adapt it for their own workflow.

**Questions? Want to share what you made with it?** Reach out at [domefestwest.com](https://domefestwest.com) or [open an issue on GitHub](https://github.com/domefestwest/fulldome-preview-converter/issues).

---

## For power users and developers

This is a polished GUI on top of a Python command-line tool. If you're integrating fulldome conversion into a render pipeline, building automation around batches of shows, or just prefer terminals, the CLI is fully featured and stable.

```bash
python convert.py --input my_film.mp4 --crop-mode 9:16 --trim-end 30 \
                  --slate-title "My Film" --slate-creator "Studio Name" \
                  --watermark logo.png --loudnorm -23
```

Run `python convert.py --help` for the full flag list. The same Python script powers the GUI — anything the GUI can do, the CLI can do, plus it's batch-friendly for shell scripting.

**Building from source:** see [BUILDING.md](BUILDING.md) (or just `cd gui && npm install && npm run dev`).

**Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md). We welcome bug reports, feature requests, and pull requests from anyone in the fulldome and planetarium community — whether you're a developer or a creator who's hit a snag.

**Project status:** v0.2.0. See [CHANGELOG.md](CHANGELOG.md) for what's new.

---

## License

MIT — see [LICENSE](LICENSE). Use this for your own films, for client work, for your studio, for your venue. We just ask that you tell other fulldome creators about it.

FFmpeg, the open-source media engine that powers the conversion under the hood, is licensed separately under LGPL/GPL. This tool calls FFmpeg as an external process and does not statically link its libraries. See [FFmpeg's legal page](https://ffmpeg.org/legal.html) for full details.
