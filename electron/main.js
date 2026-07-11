const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    title: 'PDF Annotation Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.webContents.on('console-message', (e) => {
    console.log(`[renderer] ${e.message}  (${e.sourceId}:${e.lineNumber})`);
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[did-fail-load] ${code} ${desc} ${url}`);
  });

  const blockNavigation = (event, url) => {
    if (!url.includes('/src/index.html')) {
      console.log(`[blocked-navigation] ${url}`);
      event.preventDefault();
    }
  };
  mainWindow.webContents.on('will-navigate', blockNavigation);
  mainWindow.webContents.on('will-frame-navigate', blockNavigation);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log(`[render-process-gone] ${JSON.stringify(details)}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-open'),
        },
        {
          label: 'Generate PDF from File…',
          accelerator: 'CmdOrCtrl+G',
          click: () => mainWindow?.webContents.send('menu-generate'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu-save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu-save-as'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('dialog:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'PDF Documents', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const data = await fs.readFile(filePath);
  return {
    filePath,
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  };
});

ipcMain.handle('dialog:save', async (_event, { defaultPath, data }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'document.pdf',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fs.writeFile(result.filePath, Buffer.from(data));
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('file:save', async (_event, { filePath, data }) => {
  await fs.writeFile(filePath, Buffer.from(data));
  return { filePath };
});

function htmlDocument(bodyHtml, title) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title || 'Document'}</title>
<style>
  html, body { margin: 0; }
  body {
    font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    color: #111;
    line-height: 1.5;
    font-size: 12pt;
    padding: 8px;
  }
  img, table { max-width: 100%; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #999; padding: 4px 8px; }
  h1, h2, h3 { line-height: 1.25; }
  pre, code { font-family: Consolas, "Courier New", monospace; }
  a { color: #1155cc; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

async function renderHtmlToPdfBytes(loadInto) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await loadInto(win);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });
    return new Uint8Array(pdf);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function withTempHtml(html, fn) {
  const tmpFile = path.join(os.tmpdir(), `pdftool-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await fs.writeFile(tmpFile, html, 'utf8');
  try {
    return await fn(tmpFile);
  } finally {
    fs.unlink(tmpFile).catch(() => {});
  }
}

ipcMain.handle('generate:html', async (_event, { filePath, html }) => {
  try {
    if (filePath) {
      return await renderHtmlToPdfBytes((win) => win.loadFile(filePath));
    }
    return await withTempHtml(htmlDocument(html, 'Document'), (tmp) =>
      renderHtmlToPdfBytes((win) => win.loadFile(tmp))
    );
  } catch (err) {
    console.log(`[generate:html] FAILED: ${err && err.name} - ${err && err.message}`);
    console.log(err && err.stack);
    throw new Error(`HTML conversion failed: ${err && err.message ? err.message : err}`);
  }
});

ipcMain.handle('generate:docx', async (_event, { filePath, data }) => {
  try {
    const mammoth = require('mammoth');
    const input = filePath ? { path: filePath } : { buffer: Buffer.from(data) };
    const { value: bodyHtml } = await mammoth.convertToHtml(input);
    console.log(`[generate:docx] mammoth produced ${bodyHtml.length} chars of HTML`);
    return await withTempHtml(htmlDocument(bodyHtml, 'Document'), (tmp) =>
      renderHtmlToPdfBytes((win) => win.loadFile(tmp))
    );
  } catch (err) {
    console.log(`[generate:docx] FAILED: ${err && err.name} - ${err && err.message}`);
    console.log(err && err.stack);
    throw new Error(`DOCX conversion failed: ${err && err.message ? err.message : err}`);
  }
});

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.pdftool.annotation');
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
