# PDF Annotation Tool

A fully offline, local-first desktop app (Windows + Linux) for viewing PDFs and adding **non-destructive** annotations — highlights, underlines, freehand ink, and visual (image-based) signatures — without modifying the underlying document content stream.

Built with **Electron + PDF.js** (rendering) and **pdf-lib** (annotation persistence), per `PDF-Tool-Documentation.md`.

## Digital sovereignty

- No network connectivity required to view, annotate, sign, or save.
- No telemetry, analytics, or license checks.
- All dependencies are bundled at build time (PDF.js, pdf-lib, signature_pad) — nothing is fetched at runtime.
- Runs with full functionality on an air-gapped machine.

## Requirements

- [Node.js](https://nodejs.org/) LTS (v20+; developed against v24).

## Getting started

```bash
npm install
npm start
```

## Features

- **View**: canvas rendering of all pages, zoom in/out, fit-to-width, page navigation.
- **Search**: full-text search across the document with match navigation.
- **Select / copy**: transparent text layer aligned to glyphs; standard selection + copy.
- **Highlight / Underline**: select text with the tool active to create a markup annotation.
- **Ink**: freehand drawing on the page.
- **Signature**: draw or upload an image, then place it on the page. *Visual mark only — not a legally binding cryptographic signature.*
- **Annotation panel**: list, jump to, and delete annotations.
- **Save / Save As**: writes annotations into a copy of the PDF via pdf-lib; original content stream is untouched.
- **Generate PDF**: convert a non-PDF file into a PDF, entirely offline, and save it to a location of your choice (with an option to open it in the viewer). Also offered automatically when you drag a non-PDF file onto the window. Supported sources:
  - **Text** (txt, csv, tsv, md, log, json) — laid out with wrapping/pagination via pdf-lib.
  - **HTML** (htm, html) — rendered locally via Electron's `printToPDF`.
  - **Word** (.docx) — converted to HTML with the bundled `mammoth`, then rendered via `printToPDF`.

## Tools

Use the toolbar (top-right) to switch between `Select`, `Highlight`, `Underline`, `Ink`, and `Sign`. The color picker sets the color for markup and ink.

## Building installers

```bash
npm run build:win     # Windows: NSIS installer + portable .exe
npm run build:linux   # Linux: .AppImage + .deb
```

Output is written to `dist/`. All dependencies are bundled — no internet access is needed at install time.

> Cross-platform note: build Windows artifacts on Windows and Linux artifacts on Linux (or via a Linux CI runner/container). electron-builder does not cross-compile the Linux targets from Windows reliably.

## Linux: install & compile from source (curl)

The recommended way for Linux users is to compile from the GitHub source with a single command. The script clones the repo, installs dependencies, and builds the AppImage + `.deb` locally. Replace `OWNER/REPO` with the actual GitHub path:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/scripts/install-linux.sh | bash
```

What it does:

- Checks for `git` and Node.js **18+** (offers to install them via `apt`/`dnf`/`pacman`/`zypper`, or points you to `nvm`).
- Clones into `~/pdf-annotation-tool` (override with `PDFTOOL_DIR`).
- Runs `npm ci` / `npm install`, then `npm run build:linux`.
- Prints where the AppImage/`.deb` landed and how to launch them.

Useful overrides (environment variables):

```bash
# Just run from source instead of building an installer:
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/scripts/install-linux.sh | PDFTOOL_MODE=run bash

# Build a specific branch/tag, into a custom directory:
PDFTOOL_BRANCH=v1.0.0 PDFTOOL_DIR=~/apps/pdftool \
  bash <(curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/scripts/install-linux.sh)
```

> Security tip: it's good practice to read any `curl | bash` script first — open `scripts/install-linux.sh` in the repo to review it before running.

### Manual build from source

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO
npm install
npm run build:linux   # artifacts in dist/  (or: npm start to run without building)
```

Running the AppImage:

```bash
chmod +x dist/PDF-Annotation-Tool-*.AppImage
./dist/PDF-Annotation-Tool-*.AppImage
# If FUSE is missing: sudo apt-get install libfuse2
# or run with: ./dist/PDF-Annotation-Tool-*.AppImage --appimage-extract-and-run
```

### Downloading prebuilt binaries (releases)

Tagged releases are built by CI (`.github/workflows/release.yml`) and attached as assets, so you can skip compiling:

```bash
# Portable AppImage
curl -L -o PDF-Annotation-Tool.AppImage \
  https://github.com/OWNER/REPO/releases/latest/download/PDF-Annotation-Tool-1.0.0.AppImage
chmod +x PDF-Annotation-Tool.AppImage
./PDF-Annotation-Tool.AppImage

# Or the .deb for system-wide install
curl -L -o pdf-annotation-tool.deb \
  https://github.com/OWNER/REPO/releases/latest/download/pdf-annotation-tool_1.0.0_amd64.deb
sudo apt install ./pdf-annotation-tool.deb
```

Everything runs fully offline after download — no network access is required at runtime.

## Project structure

```
electron/
  main.js       Electron main process: window, menus, native file dialogs, disk I/O
  preload.js    Secure contextBridge API exposed to the renderer
src/
  index.html    App shell + toolbar + signature dialog
  styles.css    UI styling
  renderer.js   Multi-document viewer, tools, search, annotation rendering
  pdf-generate.js  Text/HTML/DOCX -> PDF conversion
  pdf-save.js   Translates annotations into PDF objects via pdf-lib
scripts/
  install-linux.sh   curl-to-compile installer for Linux
.github/workflows/
  release.yml   CI: build Windows + Linux artifacts, attach to tagged releases
```

## Limitations (by design)

- No content editing or text reflow.
- No cryptographic / legal-grade e-signatures.
- No web/server component, cloud storage, or sync.
