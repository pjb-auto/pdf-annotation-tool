# PDF Viewer & Annotation Tool — Technical Documentation

## 1. Overview

A **standalone desktop application** (Windows + Linux) for viewing PDF files and adding **non-destructive annotations** — highlights, text selection/copy, and visual (image-based) signatures — without modifying the underlying document content stream.

**Out of scope:** content editing, text reflow, cryptographic (PAdES/PKCS#7) signatures, any web service or hosted component.

### 1.1 Digital Sovereignty

This is a fully offline, local-first application:
- No network/internet connectivity is required to run, view, annotate, sign, or save files.
- No telemetry, analytics, update-pinging, or license-check calls to any server.
- All file processing (rendering, annotation, signing) happens entirely in-process on the local machine; no document data, images, or signatures are transmitted anywhere.
- The app should be usable on an air-gapped machine with zero degradation of functionality.
- Any future auto-update mechanism must be opt-in and clearly disclosed, never silent or default-on.

## 2. Architecture

Two viable paths, both delivering a native, installable desktop app for Windows and Linux with no server component:

| Option | Description | Trade-off |
|---|---|---|
| **A — Electron** | Bundles Chromium + Node.js; use PDF.js directly (it's built for this environment). Packaged as a `.exe` (Windows) and `.AppImage`/`.deb` (Linux) via Electron Builder. | Larger binary (~150–200 MB), but fastest path to a polished UI and the most mature PDF rendering (PDF.js). Runs fully offline — Electron does not require internet at runtime. |
| **B — Native (Qt/PySide6)** | Use `QPdfView`/`QPdfDocument` (Qt PDF module) or `PyMuPDF` for rendering, PySide6/Qt Widgets for UI. Packaged via PyInstaller/Nuitka or Qt's own deployment tools. | Smaller, more "native-feeling" binary; more manual work for a PDF.js-equivalent text layer and annotation UI. |

This document assumes **Option A (Electron + PDF.js)** as the default recommendation, since it directly reuses the browser-based approach discussed earlier while still shipping as a standalone installable app — Electron does not mean "web app": it is a packaged native application with its own bundled runtime, and requires no server, hosting, or connectivity.

| Layer | Responsibility | Library |
|---|---|---|
| Rendering & text layer | Render PDF pages to canvas; expose selectable text positioned over glyphs | **PDF.js** (bundled locally, not loaded from a CDN) |
| Annotation layer | Draw highlights, signature overlays on top of rendered pages | Custom (HTML/SVG over canvas) |
| Annotation persistence | Write annotation objects into the PDF file | **pdf-lib** (bundled locally) |
| Application shell | Native window, file system access, menus, packaging | Electron + Electron Builder |

Data flow: `PDF.js` renders pages and produces the text layer → user interacts (select / draw) → app builds annotation objects in memory → on save, annotation objects are written into the PDF via `pdf-lib`, leaving the original content stream untouched. All steps run in the local Electron process; nothing is sent over a network.

**Important implementation note for Option A:** all dependencies (PDF.js, pdf-lib, fonts) must be bundled into the app package at build time rather than fetched at runtime, so the app has zero network dependency even on first launch.

## 3. Features

### 3.1 Viewing
- Render pages via PDF.js canvas rendering.
- Pan, zoom, page navigation, search (PDF.js provides a built-in text search API).

### 3.2 Copy / Select Text
- PDF.js generates a transparent text layer aligned to rendered glyphs.
- Standard browser text selection + Clipboard API (`navigator.clipboard.writeText`) — no custom logic required.

### 3.3 Highlighting
- On text selection, PDF.js exposes the selection's bounding quad points.
- App creates a `Highlight` annotation object: page index, quad points, color, timestamp.
- Rendered immediately as an overlay (client-side); persisted on save.
- Same pattern extends to `Underline`, `StrikeOut`, `Squiggly`, and freehand `Ink` annotations.

### 3.4 Visual Signature
- User either draws a signature (canvas ink capture) or uploads an image (PNG with transparency recommended).
- User positions and resizes the signature on the page (drag/resize handles).
- Signature is embedded as an **image XObject** placed on the page via a `Stamp`-style annotation or by drawing directly onto the page content at save time.
- **Not cryptographically verifiable** — it is a visual mark only, no certificate, hash, or tamper-evidence. This should be stated clearly in the UI so users don't mistake it for a legal digital signature.

## 4. Annotation Data Model

```
Annotation {
  id: string
  type: "highlight" | "underline" | "strikeout" | "ink" | "signature"
  page: number
  rects: [{ x, y, width, height }]   // or quadPoints for text markup
  color: string
  imageData?: base64                 // for signature/ink
  createdAt: timestamp
}
```

Annotations are held in memory as this app-level model, then translated to native PDF annotation dictionaries (`/Subtype /Highlight`, `/Subtype /Stamp`, etc.) only at save time. This keeps the in-app model simple and library-agnostic.

## 5. File I/O

- **Open**: local file system access via Electron's native file dialog (`dialog.showOpenDialog`); file is read from disk into memory, PDF.js renders it. No upload step — the file never leaves the machine.
- **Save**: apply the in-memory annotation list to a copy of the original bytes using `pdf-lib`, written back to local disk via Electron's file system APIs. The original content stream is never modified — only new annotation objects and, for signatures, a new image XObject + placement, are added.
- **Save As / Export**: same process, written to a new local path via the native save dialog.
- All file I/O uses Electron's `fs`/`dialog` modules directly against the local file system — no browser upload/download mechanism, no temp server, no cloud sync of any kind.

## 6. Suggested Libraries (all run locally, no external calls)

| Purpose | Library | Notes |
|---|---|---|
| Render/view | `pdfjs-dist` | Bundle the npm package into the app; do not reference Mozilla's hosted CDN build. |
| Annotate/save | `pdf-lib` | Pure JS, no network dependency. |
| Signature capture | `signature_pad` | Canvas-based ink capture, runs entirely client-side. |
| App shell/packaging | `electron`, `electron-builder` | Produces Windows (`.exe`/NSIS installer) and Linux (`.AppImage`, `.deb`) builds. |

## 7. Non-Goals / Limitations

- No text reflow or content editing.
- No legal-grade e-signature (no certificate chain, no tamper detection).
- No web/server component, no cloud storage or sync integration.
- Complex PDFs (heavily compressed, malformed, or DRM-protected) rely entirely on PDF.js's/pdf-lib's parsing robustness — no custom parser is built.

## 8. Packaging & Distribution

- Build targets: Windows (NSIS installer or portable `.exe`) and Linux (`.AppImage` for portability, `.deb` for Debian/Ubuntu-based distros).
- `electron-builder` handles both from a single build config and a single codebase.
- No installer step should require internet access — all dependencies are bundled at build time, not fetched during installation.
- No auto-launch background services; the app runs only while explicitly opened by the user.

## 9. Suggested Milestones

1. Electron shell + PDF.js viewer with pan/zoom/search (local file open only)
2. Text layer + copy/select
3. Highlight annotation (create, render, persist to local disk)
4. Additional markup types (underline, ink)
5. Visual signature capture + placement + persist
6. Save/export polish (undo, annotation list panel, delete/edit annotations)
7. Windows + Linux packaging via electron-builder
