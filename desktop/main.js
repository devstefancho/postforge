const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { spawn } = require('node:child_process');
const { generateSlug } = require('./slug-generator');
const { proofread, SIZE_WARN_THRESHOLD } = require('./proofreader');
const { generateDescription } = require('./description-generator');
const { generateHero, hasApiKey: hasGeminiKey, ENV_KEY: GEMINI_ENV_KEY } = require('./hero-generator');
const { translateTopic } = require('./hero-topic-translator');

// ──────────────────────────────────────
// .env loading (project root)
// The Express server uses `dotenv/config`; Electron main has its own process
// so we mirror that here for GEMINI_API_KEY (ADR-0004).
// ──────────────────────────────────────

function parseEnvFile(content) {
  const out = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;
  const parsed = parseEnvFile(readFileSync(envPath, 'utf-8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// ──────────────────────────────────────
// Config (API URL + Token)
// ──────────────────────────────────────

const CONFIG_PATH = join(app.getPath('userData'), 'config.json');

function loadConfig() {
  const defaults = {
    activeEnv: 'local',
    envs: {
      local: { apiBaseUrl: 'http://localhost:8788', apiToken: '' },
      production: { apiBaseUrl: '', apiToken: '' },
    },
  };
  try {
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      if (!saved.envs) {
        return {
          activeEnv: 'local',
          envs: {
            local: defaults.envs.local,
            production: { apiBaseUrl: saved.apiBaseUrl || '', apiToken: saved.apiToken || '' },
          },
        };
      }
      return { ...defaults, ...saved };
    }
  } catch {}
  return defaults;
}

function saveConfig(config) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ──────────────────────────────────────
// Electron App
// ──────────────────────────────────────

let mainWindow;

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Post',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu-new-post'),
        },
        {
          label: 'Open Post',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-open-post'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu-save'),
        },
        { type: 'separator' },
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow?.webContents.send('menu-dashboard'),
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu-settings'),
        },
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
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'PostForge',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(join(__dirname, 'editor.html'));
  createMenu();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers
ipcMain.on('set-title', (_, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});

ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('save-config', (_, config) => {
  const current = loadConfig();
  const updated = { ...current, ...config };
  saveConfig(updated);
  return updated;
});

ipcMain.handle('generate-slug', async (_, title) => {
  try {
    const slug = await generateSlug({ title });
    return { ok: true, slug };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('generate-description', async (_, payload) => {
  try {
    const description = await generateDescription({
      title: payload?.title,
      body: payload?.body,
    });
    return { ok: true, description };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('generate-hero', async (_, payload) => {
  if (!hasGeminiKey()) {
    return { ok: false, disabled: true, error: `${GEMINI_ENV_KEY} not set` };
  }
  try {
    // Imagen draws "ghost glyphs" if the prompt contains Korean. Compress the
    // user-facing fields down to one English noun phrase first, then feed
    // only that phrase to Imagen. See ADR-0004.
    const topic = await translateTopic({
      title: payload?.title,
      description: payload?.description,
      tags: payload?.tags,
      category: payload?.category,
    });
    const image = await generateHero({ topic });
    return { ok: true, base64: image.base64, mimeType: image.mimeType };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('hero-auto-available', () => hasGeminiKey());

// Proofread — single-flight; a new invocation aborts any in-flight one.
let proofreadAbort = null;
ipcMain.handle('proofread', async (_, body) => {
  if (proofreadAbort) proofreadAbort.abort();
  const ctrl = new AbortController();
  proofreadAbort = ctrl;
  try {
    const corrected = await proofread({ body, signal: ctrl.signal });
    return { ok: true, body: corrected };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (proofreadAbort === ctrl) proofreadAbort = null;
  }
});

ipcMain.handle('cancel-proofread', () => {
  if (proofreadAbort) {
    proofreadAbort.abort();
    return true;
  }
  return false;
});

ipcMain.handle('proofread-warn-threshold', () => SIZE_WARN_THRESHOLD);

ipcMain.handle('show-image-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
    title: 'Select Image',
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const data = readFileSync(filePath);
  const ext = filePath.split('.').pop();
  const filename = `image-${Date.now()}.${ext}`;

  return {
    filename,
    data: data.toString('base64'),
    originalPath: filePath,
  };
});

// ──────────────────────────────────────
// Local API Server (Express via tsx)
// ──────────────────────────────────────

const PROJECT_ROOT = join(__dirname, '..');
let serverProcess = null;

function startLocalServer() {
  serverProcess = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
    shell: true,
  });

  serverProcess.on('error', () => { serverProcess = null; });
  serverProcess.on('exit', () => { serverProcess = null; });
}

function stopLocalServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// App lifecycle
app.whenReady().then(() => {
  loadDotEnv(join(PROJECT_ROOT, '.env'));
  startLocalServer();
  createWindow();
});

app.on('window-all-closed', () => {
  stopLocalServer();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
