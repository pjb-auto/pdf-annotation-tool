import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';
import SignaturePad from '../node_modules/signature_pad/dist/signature_pad.js';
import { savePdfWithAnnotations } from './pdf-save.js';
import {
  detectKind,
  canGenerate,
  textToPdf,
  suggestedPdfName,
} from './pdf-generate.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

// Global UI state (not per-document).
const ui = {
  tool: 'select',
  highlightColor: '#ffff00',
  isDrawing: false,
  inkPoints: [],
};

// Open documents. Each entry owns its own render surface + state.
let docs = [];
let activeId = null;

const els = {
  btnOpen: document.getElementById('btn-open'),
  btnGenerate: document.getElementById('btn-generate'),
  generateInput: document.getElementById('generate-input'),
  btnSave: document.getElementById('btn-save'),
  btnSaveAs: document.getElementById('btn-save-as'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  pageInfo: document.getElementById('page-info'),
  pageInput: document.getElementById('page-input'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomFit: document.getElementById('btn-zoom-fit'),
  zoomInfo: document.getElementById('zoom-info'),
  searchInput: document.getElementById('search-input'),
  btnSearchPrev: document.getElementById('btn-search-prev'),
  btnSearchNext: document.getElementById('btn-search-next'),
  searchInfo: document.getElementById('search-info'),
  highlightColor: document.getElementById('highlight-color'),
  emptyState: document.getElementById('empty-state'),
  viewer: document.getElementById('viewer'),
  viewerContainer: document.getElementById('viewer-container'),
  tabBar: document.getElementById('tab-bar'),
  sidebar: document.getElementById('sidebar'),
  annotationList: document.getElementById('annotation-list'),
  signatureDialog: document.getElementById('signature-dialog'),
  signatureCanvas: document.getElementById('signature-canvas'),
  sigClear: document.getElementById('sig-clear'),
  sigCancel: document.getElementById('sig-cancel'),
  sigConfirm: document.getElementById('sig-confirm'),
  sigTabSaved: document.getElementById('sig-tab-saved'),
  sigTabDraw: document.getElementById('sig-tab-draw'),
  sigTabUpload: document.getElementById('sig-tab-upload'),
  sigSavedPanel: document.getElementById('sig-saved-panel'),
  sigSavedList: document.getElementById('sig-saved-list'),
  sigSavedEmpty: document.getElementById('sig-saved-empty'),
  sigDrawPanel: document.getElementById('sig-draw-panel'),
  sigUploadPanel: document.getElementById('sig-upload-panel'),
  sigFileInput: document.getElementById('sig-file-input'),
  sigPreview: document.getElementById('sig-preview'),
  sigSaveRow: document.getElementById('sig-save-row'),
  sigSaveCheckbox: document.getElementById('sig-save-checkbox'),
  btnOpenEmpty: document.getElementById('btn-open-empty'),
};

let signaturePad = null;

function activeDoc() {
  return docs.find((d) => d.id === activeId) || null;
}

function init() {
  bindToolbar();
  bindMenuShortcuts();
  bindDragAndDrop();
  bindSignatureDialog();
  els.btnOpenEmpty.addEventListener('click', openFile);
  updateChrome();
}

/* ------------------------------------------------------------------ */
/* Input handling: open / generate / drag-drop                         */
/* ------------------------------------------------------------------ */

function bindDragAndDrop() {
  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  ['dragenter', 'dragover'].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      stop(e);
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      document.body.classList.add('drag-over');
    });
  });

  ['dragleave', 'dragend'].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      stop(e);
      if (evt === 'dragleave' && e.relatedTarget) return;
      document.body.classList.remove('drag-over');
    });
  });

  document.addEventListener('drop', (e) => {
    stop(e);
    document.body.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    handleDroppedFile(file);
  });
}

function bindToolbar() {
  els.btnOpen.addEventListener('click', openFile);
  els.btnGenerate.addEventListener('click', () => els.generateInput.click());
  els.generateInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) runGenerate(file);
  });
  els.btnSave.addEventListener('click', () => saveFile(false));
  els.btnSaveAs.addEventListener('click', () => saveFile(true));
  els.btnPrev.addEventListener('click', () => goToPage(getCurrentPage() - 1));
  els.btnNext.addEventListener('click', () => goToPage(getCurrentPage() + 1));
  els.pageInput.addEventListener('change', () => goToPage(parseInt(els.pageInput.value, 10)));
  els.btnZoomOut.addEventListener('click', () => setScale(getScale() * 0.8));
  els.btnZoomIn.addEventListener('click', () => setScale(getScale() * 1.25));
  els.btnZoomFit.addEventListener('click', fitToWidth);
  els.searchInput.addEventListener('input', debounce(handleSearch, 300));
  els.btnSearchPrev.addEventListener('click', () => navigateSearch(-1));
  els.btnSearchNext.addEventListener('click', () => navigateSearch(1));
  els.highlightColor.addEventListener('input', (e) => {
    ui.highlightColor = e.target.value;
  });

  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
}

function bindMenuShortcuts() {
  window.electronAPI.onMenuOpen(() => openFile());
  window.electronAPI.onMenuGenerate(() => els.generateInput.click());
  window.electronAPI.onMenuSave(() => saveFile(false));
  window.electronAPI.onMenuSaveAs(() => saveFile(true));
}

function getScale() {
  return activeDoc()?.scale ?? 1.0;
}

function getCurrentPage() {
  return activeDoc()?.currentPage ?? 1;
}

async function convertFileToPdfBytes(file) {
  const kind = detectKind(file.name);
  console.log(`generate: kind=${kind} name="${file.name}" type="${file.type}" size=${file.size}`);

  if (kind === 'text') {
    return textToPdf(await file.text());
  }
  if (kind === 'html') {
    const filePath = window.electronAPI.getPathForFile(file);
    const options = filePath ? { filePath } : { html: await file.text() };
    return new Uint8Array(await window.electronAPI.generateHtmlPdf(options));
  }
  if (kind === 'docx') {
    const data = new Uint8Array(await file.arrayBuffer());
    return new Uint8Array(await window.electronAPI.generateDocxPdf({ data }));
  }
  return null;
}

async function runGenerate(file) {
  if (!canGenerate(file.name)) {
    alert(`Can't generate a PDF from "${file.name}".\n\nSupported types: text (txt, csv, md, log, json), HTML, and Word (.docx).`);
    return;
  }

  let bytes;
  try {
    setGenerating(true);
    bytes = await convertFileToPdfBytes(file);
  } catch (err) {
    console.error('PDF generation failed:', describeError(err));
    alert(`Could not generate a PDF from "${file.name}".\n\n${describeError(err)}`);
    return;
  } finally {
    setGenerating(false);
  }

  if (!bytes || bytes.length === 0) {
    alert(`Could not generate a PDF from "${file.name}".`);
    return;
  }

  const result = await window.electronAPI.saveFile({
    defaultPath: suggestedPdfName(file.name),
    data: bytes,
  });
  if (result.canceled) return;

  const openNow = confirm(`PDF generated and saved to:\n${result.filePath}\n\nOpen it in the viewer now?`);
  if (openNow) {
    await loadPdf(new Uint8Array(bytes), result.filePath);
  }
}

function setGenerating(active) {
  els.btnGenerate.disabled = active;
  els.btnGenerate.textContent = active ? 'Generating…' : 'Generate PDF';
}

function describeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const parts = [];
  if (err.name) parts.push(err.name);
  if (err.message) parts.push(err.message);
  const joined = parts.join(': ');
  if (joined) return joined;
  try {
    return err.toString();
  } catch {
    return JSON.stringify(err);
  }
}

function baseName(filePath) {
  return (filePath || '').split(/[\\/]/).pop() || 'document.pdf';
}

function isAbsolutePath(p) {
  return typeof p === 'string' && (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\'));
}

function looksLikePdf(bytes) {
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i + 4 < limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

async function openFile() {
  try {
    const result = await window.electronAPI.openFile();
    if (!result) return;

    const bytes = new Uint8Array(result.data);
    if (!looksLikePdf(bytes)) {
      const name = baseName(result.filePath);
      if (canGenerate(name)) {
        const proceed = confirm(`"${name}" isn't a PDF, but it can be converted.\n\nGenerate a PDF from it?`);
        if (proceed) await runGenerate(new File([bytes], name));
      } else {
        alert(`"${name}" isn't a valid PDF and can't be converted.\n\nSupported source types for conversion: text (txt, csv, md, log, json), HTML, and Word (.docx).`);
      }
      return;
    }

    await loadPdf(bytes, result.filePath);
  } catch (err) {
    console.error('Failed to open PDF:', describeError(err));
    alert(`Could not open the PDF file.\n\n${describeError(err)}`);
  }
}

async function handleDroppedFile(file) {
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksLikePdf(bytes)) {
      const path = window.electronAPI.getPathForFile(file) || file.name;
      await loadPdf(bytes, path);
      return;
    }

    if (canGenerate(file.name)) {
      const proceed = confirm(`"${file.name}" isn't a PDF, but it can be converted.\n\nGenerate a PDF from this file?`);
      if (proceed) await runGenerate(file);
      return;
    }

    alert(`"${file.name}" isn't a PDF and can't be converted to one.\n\nSupported source types: text (txt, csv, md, log, json), HTML, and Word (.docx).`);
  } catch (err) {
    console.error('Failed to open dropped file:', describeError(err));
    alert(`Could not open the dropped file.\n\n${describeError(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Document lifecycle                                                  */
/* ------------------------------------------------------------------ */

async function loadPdf(bytes, filePath) {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  loadingTask.onPassword = (updatePassword, reason) => {
    const incorrect = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
    const password = prompt(
      incorrect
        ? 'Incorrect password. Please try again:'
        : 'This PDF is password-protected. Enter the password to open it:'
    );
    if (password === null) {
      loadingTask.destroy();
    } else {
      updatePassword(password);
    }
  };

  const pdfDoc = await loadingTask.promise;

  const doc = {
    id: crypto.randomUUID(),
    title: baseName(filePath),
    filePath: isAbsolutePath(filePath) ? filePath : null,
    originalBytes: bytes,
    pdfDoc,
    annotations: [],
    scale: 1.0,
    currentPage: 1,
    search: { query: '', matches: [], index: -1 },
    pageElements: new Map(),
    viewerEl: document.createElement('div'),
    scrollTop: 0,
  };
  doc.viewerEl.className = 'doc-viewport hidden';
  els.viewer.appendChild(doc.viewerEl);
  docs.push(doc);

  console.log(`loadPdf: opened "${doc.title}", numPages=${pdfDoc.numPages}`);

  // Reveal the viewer and make this document active BEFORE rendering its pages.
  // A <canvas> rasterized while an ancestor is display:none — which happens for
  // the very first document, opened straight from the empty state — can be
  // composited by Chromium as a solid black box until its layer is rebuilt
  // (opening/closing another document is what was rebuilding it by hand).
  // Rendering into an already-visible tree avoids the problem at the source.
  activateDoc(doc.id);
  await renderDocPages(doc);
}

function closeDoc(id) {
  const idx = docs.findIndex((d) => d.id === id);
  if (idx === -1) return;
  const [doc] = docs.splice(idx, 1);

  try {
    doc.pdfDoc.destroy();
  } catch { /* ignore */ }
  doc.viewerEl.remove();

  if (activeId === id) {
    activeId = null;
    const next = docs[idx] || docs[idx - 1] || docs[docs.length - 1];
    if (next) {
      activateDoc(next.id);
    } else {
      updateChrome();
      renderTabs();
    }
  } else {
    renderTabs();
  }
}

function activateDoc(id) {
  const prev = activeDoc();
  if (prev && prev.id !== id) {
    prev.scrollTop = els.viewerContainer.scrollTop;
  }

  activeId = id;
  const doc = activeDoc();

  for (const d of docs) {
    d.viewerEl.classList.toggle('hidden', d.id !== id);
  }

  updateChrome();
  renderTabs();
  refreshAnnotationList();
  updateInkLayers();

  if (doc) {
    els.searchInput.value = doc.search.query;
    updateSearchInfo();
    updatePageInfo();
    els.zoomInfo.textContent = `${Math.round(doc.scale * 100)}%`;
    els.viewerContainer.scrollTop = doc.scrollTop || 0;
  }
}

function renderTabs() {
  els.tabBar.innerHTML = '';
  els.tabBar.classList.toggle('hidden', docs.length === 0);

  for (const doc of docs) {
    const tab = document.createElement('div');
    tab.className = 'doc-tab' + (doc.id === activeId ? ' active' : '');
    tab.title = doc.title;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = doc.title;
    tab.appendChild(title);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close document';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDoc(doc.id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => {
      if (doc.id !== activeId) activateDoc(doc.id);
    });

    els.tabBar.appendChild(tab);
  }
}

function updateChrome() {
  const hasDoc = docs.length > 0;
  els.emptyState.classList.toggle('hidden', hasDoc);
  els.viewer.classList.toggle('hidden', !hasDoc);
  els.sidebar.classList.toggle('hidden', !hasDoc);
  enableControls(hasDoc);
  if (!hasDoc) {
    els.pageInfo.textContent = '— / —';
    els.pageInput.value = 1;
    els.zoomInfo.textContent = '100%';
    els.searchInfo.textContent = '';
    els.searchInput.value = '';
    els.annotationList.innerHTML = '';
  }
}

function enableControls(enabled) {
  const controls = [
    els.btnSave, els.btnSaveAs, els.btnPrev, els.btnNext,
    els.pageInput, els.btnZoomOut, els.btnZoomIn, els.btnZoomFit,
    els.searchInput, els.btnSearchPrev, els.btnSearchNext,
  ];
  controls.forEach((el) => { el.disabled = !enabled; });
}

/* ------------------------------------------------------------------ */
/* Page rendering                                                      */
/* ------------------------------------------------------------------ */

async function renderDocPages(doc) {
  doc.viewerEl.innerHTML = '';
  doc.pageElements.clear();

  for (let i = 1; i <= doc.pdfDoc.numPages; i++) {
    const pageEl = await renderPage(doc, i);
    doc.viewerEl.appendChild(pageEl);
    doc.pageElements.set(i, pageEl);
  }

  renderAllAnnotations(doc);
}

async function renderPage(doc, pageNum) {
  const page = await doc.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: doc.scale });

  const container = document.createElement('div');
  container.className = 'page-container';
  container.dataset.page = pageNum;
  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;
  container.style.setProperty('--scale-factor', doc.scale);

  const outputScale = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.className = 'render-canvas';
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  await page.render({ canvasContext: ctx, viewport, transform }).promise;

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  container.appendChild(textLayerDiv);

  const textContent = await page.getTextContent();
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();

  const annotationLayer = document.createElement('div');
  annotationLayer.className = 'annotationLayer';
  container.appendChild(annotationLayer);

  const inkCanvas = document.createElement('canvas');
  inkCanvas.className = 'ink-canvas';
  inkCanvas.width = Math.floor(viewport.width * outputScale);
  inkCanvas.height = Math.floor(viewport.height * outputScale);
  inkCanvas.style.width = `${Math.floor(viewport.width)}px`;
  inkCanvas.style.height = `${Math.floor(viewport.height)}px`;
  inkCanvas.getContext('2d').scale(outputScale, outputScale);
  if (ui.tool === 'ink') inkCanvas.classList.add('drawing');
  container.appendChild(inkCanvas);

  bindPageEvents(doc, container, pageNum);

  return container;
}

function bindPageEvents(doc, container, pageNum) {
  const textLayer = container.querySelector('.textLayer');
  textLayer.style.pointerEvents = (ui.tool === 'select' || ui.tool === 'highlight' || ui.tool === 'underline') ? 'auto' : 'none';

  textLayer.addEventListener('mouseup', () => {
    if (ui.tool === 'highlight' || ui.tool === 'underline') {
      handleTextMarkup(doc, pageNum);
    }
  });

  const inkCanvas = container.querySelector('.ink-canvas');
  inkCanvas.addEventListener('mousedown', (e) => startInk(e, doc, inkCanvas));
  inkCanvas.addEventListener('mousemove', (e) => continueInk(e, doc, inkCanvas));
  inkCanvas.addEventListener('mouseup', () => endInk(doc, pageNum, inkCanvas));
  inkCanvas.addEventListener('mouseleave', () => endInk(doc, pageNum, inkCanvas));
}

/* ------------------------------------------------------------------ */
/* Annotations (per document)                                          */
/* ------------------------------------------------------------------ */

function addAnnotation(doc, annotation) {
  const ann = { id: crypto.randomUUID(), createdAt: Date.now(), ...annotation };
  doc.annotations.push(ann);
  refreshAnnotationList();
  return ann;
}

function removeAnnotation(doc, id) {
  doc.annotations = doc.annotations.filter((a) => a.id !== id);
  refreshAnnotationList();
}

function annotationsForPage(doc, page) {
  return doc.annotations.filter((a) => a.page === page);
}

function handleTextMarkup(doc, pageNum) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const pageEl = doc.pageElements.get(pageNum);
  if (!pageEl) return;
  const pageRect = pageEl.getBoundingClientRect();

  const range = selection.getRangeAt(0);
  const rects = [];
  for (const clientRect of range.getClientRects()) {
    if (clientRect.width === 0 || clientRect.height === 0) continue;
    rects.push({
      x: (clientRect.left - pageRect.left) / doc.scale,
      y: (clientRect.top - pageRect.top) / doc.scale,
      width: clientRect.width / doc.scale,
      height: clientRect.height / doc.scale,
    });
  }

  if (rects.length === 0) return;

  addAnnotation(doc, {
    type: ui.tool,
    page: pageNum - 1,
    rects,
    color: ui.highlightColor,
  });

  selection.removeAllRanges();
  renderAnnotationsForPage(doc, pageNum);
}

function startInk(e, doc, canvas) {
  if (ui.tool !== 'ink') return;
  ui.isDrawing = true;
  ui.inkPoints = [];
  const rect = canvas.getBoundingClientRect();
  ui.inkPoints.push({ x: (e.clientX - rect.left) / doc.scale, y: (e.clientY - rect.top) / doc.scale });
}

function continueInk(e, doc, canvas) {
  if (!ui.isDrawing || ui.tool !== 'ink') return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / doc.scale;
  const y = (e.clientY - rect.top) / doc.scale;
  ui.inkPoints.push({ x, y });

  const ctx = canvas.getContext('2d');
  const pts = ui.inkPoints;
  if (pts.length < 2) return;
  const p0 = pts[pts.length - 2];
  const p1 = pts[pts.length - 1];
  ctx.strokeStyle = ui.highlightColor;
  ctx.lineWidth = 2 * doc.scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p0.x * doc.scale, p0.y * doc.scale);
  ctx.lineTo(p1.x * doc.scale, p1.y * doc.scale);
  ctx.stroke();
}

function endInk(doc, pageNum, canvas) {
  if (!ui.isDrawing) return;
  ui.isDrawing = false;

  if (ui.inkPoints.length >= 2) {
    addAnnotation(doc, {
      type: 'ink',
      page: pageNum - 1,
      points: [...ui.inkPoints],
      color: ui.highlightColor,
      lineWidth: 2,
    });
  }

  ui.inkPoints = [];
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  renderAnnotationsForPage(doc, pageNum);
}

function renderAllAnnotations(doc) {
  for (let i = 1; i <= doc.pdfDoc.numPages; i++) {
    renderAnnotationsForPage(doc, i);
  }
}

function renderAnnotationsForPage(doc, pageNum) {
  const pageEl = doc.pageElements.get(pageNum);
  if (!pageEl) return;

  const layer = pageEl.querySelector('.annotationLayer');
  layer.innerHTML = '';

  for (const ann of annotationsForPage(doc, pageNum - 1)) {
    if (ann.type === 'highlight' || ann.type === 'underline') {
      for (const rect of ann.rects) {
        const div = document.createElement('div');
        div.className = ann.type === 'highlight' ? 'highlight-rect' : 'underline-rect';
        div.style.left = `${rect.x * doc.scale}px`;
        div.style.top = `${rect.y * doc.scale}px`;
        div.style.width = `${rect.width * doc.scale}px`;
        div.style.height = `${rect.height * doc.scale}px`;
        if (ann.type === 'highlight') {
          div.style.backgroundColor = ann.color;
          div.style.opacity = '0.4';
        } else {
          div.style.borderColor = ann.color;
        }
        layer.appendChild(div);
      }
    } else if (ann.type === 'ink') {
      const outputScale = window.devicePixelRatio || 1;
      const cssW = pageEl.offsetWidth;
      const cssH = pageEl.offsetHeight;
      const canvas = document.createElement('canvas');
      canvas.className = 'ink-render';
      canvas.width = Math.floor(cssW * outputScale);
      canvas.height = Math.floor(cssH * outputScale);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext('2d');
      ctx.scale(outputScale, outputScale);
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = (ann.lineWidth || 2) * doc.scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < ann.points.length; i++) {
        const p = ann.points[i];
        const sx = p.x * doc.scale;
        const sy = p.y * doc.scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      layer.appendChild(canvas);
    } else if (ann.type === 'signature') {
      const rect = ann.rects[0];
      const div = document.createElement('div');
      div.className = 'signature-overlay';
      div.style.left = `${rect.x * doc.scale}px`;
      div.style.top = `${rect.y * doc.scale}px`;
      div.style.width = `${rect.width * doc.scale}px`;
      div.style.height = `${rect.height * doc.scale}px`;
      const img = document.createElement('img');
      img.src = ann.imageData;
      div.appendChild(img);
      makeDraggable(doc, div, ann);
      layer.appendChild(div);
    }
  }
}

function makeDraggable(doc, el, ann) {
  let dragging = false;
  let startX, startY, origX, origY;

  el.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = ann.rects[0].x;
    origY = ann.rects[0].y;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / doc.scale;
    const dy = (e.clientY - startY) / doc.scale;
    ann.rects[0].x = origX + dx;
    ann.rects[0].y = origY + dy;
    el.style.left = `${ann.rects[0].x * doc.scale}px`;
    el.style.top = `${ann.rects[0].y * doc.scale}px`;
  });

  window.addEventListener('mouseup', () => { dragging = false; });
}

function updateInkLayers() {
  const doc = activeDoc();
  if (!doc) return;
  doc.viewerEl.querySelectorAll('.ink-canvas').forEach((canvas) => {
    canvas.classList.toggle('drawing', ui.tool === 'ink');
  });
  doc.viewerEl.querySelectorAll('.textLayer').forEach((layer) => {
    layer.style.pointerEvents = (ui.tool === 'select' || ui.tool === 'highlight' || ui.tool === 'underline') ? 'auto' : 'none';
  });
}

function setTool(tool) {
  ui.tool = tool;
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  if (tool === 'signature') {
    openSignatureDialog();
    setTool('select');
    return;
  }

  updateInkLayers();
}

/* ------------------------------------------------------------------ */
/* Navigation / zoom / search (active document)                        */
/* ------------------------------------------------------------------ */

function goToPage(num) {
  const doc = activeDoc();
  if (!doc || !Number.isFinite(num)) return;
  num = Math.max(1, Math.min(num, doc.pdfDoc.numPages));
  doc.currentPage = num;
  updatePageInfo();

  const pageEl = doc.pageElements.get(num);
  if (pageEl) pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updatePageInfo() {
  const doc = activeDoc();
  if (!doc) return;
  els.pageInfo.textContent = `${doc.currentPage} / ${doc.pdfDoc.numPages}`;
  els.pageInput.value = doc.currentPage;
  els.pageInput.max = doc.pdfDoc.numPages;
}

async function setScale(newScale) {
  const doc = activeDoc();
  if (!doc) return;
  doc.scale = Math.max(0.25, Math.min(newScale, 5.0));
  els.zoomInfo.textContent = `${Math.round(doc.scale * 100)}%`;
  await renderDocPages(doc);
  clearSearchHighlights(doc);
  if (doc.search.query) await handleSearch();
}

async function fitToWidth() {
  const doc = activeDoc();
  if (!doc) return;
  const page = await doc.pdfDoc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const containerWidth = els.viewerContainer.clientWidth - 48;
  await setScale(containerWidth / viewport.width);
}

async function handleSearch() {
  const doc = activeDoc();
  if (!doc) return;

  const query = els.searchInput.value.trim();
  doc.search.query = query;
  clearSearchHighlights(doc);

  if (!query) {
    doc.search.matches = [];
    doc.search.index = -1;
    updateSearchInfo();
    return;
  }

  const matches = [];
  const lowerQuery = query.toLowerCase();
  for (let i = 1; i <= doc.pdfDoc.numPages; i++) {
    const page = await doc.pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join('');
    const lowerPageText = pageText.toLowerCase();
    let startIdx = 0;
    while (true) {
      const idx = lowerPageText.indexOf(lowerQuery, startIdx);
      if (idx === -1) break;
      matches.push({ page: i, index: idx, length: query.length });
      startIdx = idx + 1;
    }
  }

  doc.search.matches = matches;
  doc.search.index = matches.length > 0 ? 0 : -1;
  updateSearchInfo();
  if (doc.search.index >= 0) highlightSearchMatch(doc, doc.search.index);
}

function navigateSearch(direction) {
  const doc = activeDoc();
  if (!doc || doc.search.matches.length === 0) return;
  const n = doc.search.matches.length;
  doc.search.index = (doc.search.index + direction + n) % n;
  updateSearchInfo();
  highlightSearchMatch(doc, doc.search.index);
}

function updateSearchInfo() {
  const doc = activeDoc();
  if (!doc) {
    els.searchInfo.textContent = '';
    return;
  }
  if (doc.search.matches.length === 0) {
    els.searchInfo.textContent = doc.search.query ? 'No results' : '';
  } else {
    els.searchInfo.textContent = `${doc.search.index + 1} / ${doc.search.matches.length}`;
  }
}

async function highlightSearchMatch(doc, matchIdx) {
  clearSearchHighlights(doc);
  const match = doc.search.matches[matchIdx];
  if (!match) return;

  goToPage(match.page);

  const page = await doc.pdfDoc.getPage(match.page);
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: doc.scale });
  const pageEl = doc.pageElements.get(match.page);
  if (!pageEl) return;

  let charCount = 0;
  const matchStart = match.index;
  const matchEnd = match.index + match.length;

  for (const item of textContent.items) {
    const itemStart = charCount;
    const itemEnd = charCount + item.str.length;
    if (itemEnd > matchStart && itemStart < matchEnd) {
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
      const div = document.createElement('div');
      div.className = 'search-highlight current';
      div.style.left = `${tx[4]}px`;
      div.style.top = `${tx[5] - fontSize}px`;
      div.style.width = `${item.width * doc.scale}px`;
      div.style.height = `${fontSize}px`;
      pageEl.querySelector('.annotationLayer').appendChild(div);
    }
    charCount += item.str.length;
  }
}

function clearSearchHighlights(doc) {
  const scope = doc ? doc.viewerEl : document;
  scope.querySelectorAll('.search-highlight').forEach((el) => el.remove());
}

/* ------------------------------------------------------------------ */
/* Annotation sidebar                                                  */
/* ------------------------------------------------------------------ */

function refreshAnnotationList() {
  const doc = activeDoc();
  els.annotationList.innerHTML = '';
  if (!doc) return;

  for (const ann of doc.annotations) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `Page ${ann.page + 1} — ${ann.type}`;
    li.appendChild(label);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-ann';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeAnnotation(doc, ann.id);
      renderAnnotationsForPage(doc, ann.page + 1);
    });
    li.addEventListener('click', () => goToPage(ann.page + 1));
    li.appendChild(delBtn);
    els.annotationList.appendChild(li);
  }
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

async function saveFile(saveAs) {
  const doc = activeDoc();
  if (!doc) return;

  // Always flatten from the pristine original so repeated saves don't burn the
  // same annotations in more than once. `originalBytes` stays untouched.
  const savedBytes = await savePdfWithAnnotations(doc.originalBytes, doc.annotations);

  if (saveAs || !doc.filePath) {
    const result = await window.electronAPI.saveFile({
      defaultPath: doc.filePath || doc.title || 'document.pdf',
      data: savedBytes,
    });
    if (!result.canceled) {
      doc.filePath = result.filePath;
      doc.title = baseName(result.filePath);
      renderTabs();
    }
  } else {
    await window.electronAPI.saveToPath({ filePath: doc.filePath, data: savedBytes });
  }
}

/* ------------------------------------------------------------------ */
/* Signatures (stored locally, reusable)                               */
/* ------------------------------------------------------------------ */

const SIG_STORE_KEY = 'pdftool.savedSignatures';

function getSavedSignatures() {
  try {
    const raw = localStorage.getItem(SIG_STORE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persistSignature(dataURL) {
  const list = getSavedSignatures();
  if (list.some((s) => s.dataURL === dataURL)) return;
  list.unshift({ id: crypto.randomUUID(), dataURL, createdAt: Date.now() });
  try {
    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(list.slice(0, 20)));
  } catch (err) {
    console.error('Could not save signature:', err);
  }
}

function deleteSavedSignature(id) {
  const list = getSavedSignatures().filter((s) => s.id !== id);
  localStorage.setItem(SIG_STORE_KEY, JSON.stringify(list));
  renderSavedSignatures();
}

function renderSavedSignatures() {
  const list = getSavedSignatures();
  els.sigSavedList.innerHTML = '';
  els.sigSavedEmpty.classList.toggle('hidden', list.length > 0);

  for (const sig of list) {
    const cell = document.createElement('div');
    cell.className = 'saved-sig';

    const img = document.createElement('img');
    img.src = sig.dataURL;
    cell.appendChild(img);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'saved-sig-delete';
    del.textContent = '×';
    del.title = 'Delete saved signature';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSavedSignature(sig.id);
    });
    cell.appendChild(del);

    cell.addEventListener('click', () => {
      els.signatureDialog.close();
      placeSignature(sig.dataURL);
    });

    els.sigSavedList.appendChild(cell);
  }
}

function selectSigTab(tab) {
  const isSaved = tab === 'saved';
  const isDraw = tab === 'draw';
  const isUpload = tab === 'upload';
  els.sigTabSaved.classList.toggle('active', isSaved);
  els.sigTabDraw.classList.toggle('active', isDraw);
  els.sigTabUpload.classList.toggle('active', isUpload);
  els.sigSavedPanel.classList.toggle('hidden', !isSaved);
  els.sigDrawPanel.classList.toggle('hidden', !isDraw);
  els.sigUploadPanel.classList.toggle('hidden', !isUpload);
  els.sigSaveRow.classList.toggle('hidden', isSaved);
  els.sigConfirm.classList.toggle('hidden', isSaved);
}

function bindSignatureDialog() {
  els.sigTabSaved.addEventListener('click', () => selectSigTab('saved'));
  els.sigTabDraw.addEventListener('click', () => selectSigTab('draw'));
  els.sigTabUpload.addEventListener('click', () => selectSigTab('upload'));

  els.sigClear.addEventListener('click', () => signaturePad?.clear());

  els.sigFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Normalize to PNG: pdf-lib can only embed PNG/JPEG, so an uploaded webp
      // (allowed by the file picker) would otherwise fail when the doc is saved.
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1;
        canvas.height = img.naturalHeight || 1;
        canvas.getContext('2d').drawImage(img, 0, 0);
        els.sigPreview.src = canvas.toDataURL('image/png');
        els.sigPreview.classList.remove('hidden');
      };
      img.onerror = () => alert('That image could not be read. Try a PNG or JPEG.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  els.sigCancel.addEventListener('click', () => els.signatureDialog.close());
}

function loadImageSize(dataURL) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 3, height: 1 });
    img.src = dataURL;
  });
}

async function placeSignature(imageData) {
  const doc = activeDoc();
  if (!doc) {
    alert('Open a document first, then add a signature.');
    return;
  }
  const pageNum = doc.currentPage;
  const pageEl = doc.pageElements.get(pageNum);
  if (!pageEl) return;

  const { width: natW, height: natH } = await loadImageSize(imageData);
  const pageWidth = pageEl.offsetWidth / doc.scale;
  const pageHeight = pageEl.offsetHeight / doc.scale;

  const sigWidth = Math.min(180, pageWidth * 0.4);
  const sigHeight = sigWidth * (natH / natW || 0.35);

  addAnnotation(doc, {
    type: 'signature',
    page: pageNum - 1,
    rects: [{
      x: pageWidth / 2 - sigWidth / 2,
      y: Math.min(80, pageHeight - sigHeight - 20),
      width: sigWidth,
      height: sigHeight,
    }],
    imageData,
  });

  renderAnnotationsForPage(doc, pageNum);
}

function openSignatureDialog() {
  if (!activeDoc()) {
    alert('Open a document first, then add a signature.');
    return;
  }

  if (!signaturePad) {
    signaturePad = new SignaturePad(els.signatureCanvas, {
      backgroundColor: 'rgba(255,255,255,0)',
      penColor: '#000000',
    });
  } else {
    signaturePad.clear();
  }

  els.sigPreview.classList.add('hidden');
  els.sigPreview.removeAttribute('src');
  els.sigFileInput.value = '';
  els.sigSaveCheckbox.checked = true;

  renderSavedSignatures();
  selectSigTab(getSavedSignatures().length > 0 ? 'saved' : 'draw');

  els.signatureDialog.showModal();

  els.sigConfirm.onclick = async () => {
    let imageData = null;
    if (!els.sigUploadPanel.classList.contains('hidden') && els.sigPreview.getAttribute('src')) {
      imageData = els.sigPreview.getAttribute('src');
    } else if (!els.sigDrawPanel.classList.contains('hidden') && !signaturePad.isEmpty()) {
      imageData = signaturePad.toDataURL('image/png');
    }

    if (!imageData) return;

    if (els.sigSaveCheckbox.checked) persistSignature(imageData);

    els.signatureDialog.close();
    await placeSignature(imageData);
  };
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

init();
