const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, shell, Notification, dialog
} = require('electron');
const { spawn, exec } = require('child_process');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');
const http   = require('http');
const https  = require('https');

// ─── Dev / Prod detection ────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_DEV_URL = 'http://localhost:5173';

// ─── Global refs ─────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
const activeProcesses = new Map(); // pid → child process

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createWindow();
  createTray();
  setupIPC();
  setupMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Kill all running agent processes
  for (const [pid, proc] of activeProcesses) {
    try { proc.kill(); } catch {}
  }
});

// ─── Main window ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  900,
    minHeight: 600,
    backgroundColor: '#070711',
    // Standard OS titlebar — enables drag, minimize, close on all platforms
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      webSecurity:      false,  // Allow fetch to external APIs (Anthropic, OpenRouter, etc.)
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ─── System tray ─────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('DEFTRON — Multi-agent AI');

  const menu = Menu.buildFromTemplate([
    { label: 'Open DEFTRON', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'DEFTRON v1.0', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ─── Native menu ─────────────────────────────────────────────────────────────
function setupMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: 'DEFTRON',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Clear Memory', click: () => mainWindow?.webContents.send('menu:clear-memory') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Agents',
      submenu: [
        { label: 'Install OpenClaw…', click: () => mainWindow?.webContents.send('menu:install', 'openclaw') },
        { label: 'Install Hermes…',   click: () => mainWindow?.webContents.send('menu:install', 'hermes')   },
        { type: 'separator' },
        { label: 'OpenClaw Docs',  click: () => shell.openExternal('https://docs.openclaw.ai')                            },
        { label: 'Hermes Docs',    click: () => shell.openExternal('https://hermes-agent.nousresearch.com/docs')          },
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : [])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
function setupIPC() {

  // ── System info ──
  ipcMain.handle('app:platform', () => process.platform);
  ipcMain.handle('app:home-dir', () => os.homedir());
  ipcMain.handle('app:version',  () => app.getVersion());

  // ── Open external URL in browser ──
  ipcMain.handle('app:open-external', (_, url) => shell.openExternal(url));

  // ── Notification ──
  ipcMain.handle('app:notify', (_, { title, body }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  // ── Execute a shell command and stream output ──
  // Returns { pid } immediately; streams 'shell:output' events back
  ipcMain.handle('shell:run', (event, { command, id }) => {
    return new Promise((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
      // -l = login shell so ~/.zshrc / ~/.bashrc is sourced, npm globals are on PATH
      const args  = process.platform === 'win32' ? ['/c', command] : ['-lc', command];

      const proc = spawn(shell, args, {
        env:   { ...process.env, TERM: 'xterm-color', FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      activeProcesses.set(proc.pid, proc);

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', data => {
        event.sender.send('shell:output', { id, type: 'stdout', data });
      });
      proc.stderr.on('data', data => {
        event.sender.send('shell:output', { id, type: 'stderr', data });
      });
      proc.on('close', code => {
        activeProcesses.delete(proc.pid);
        event.sender.send('shell:output', { id, type: 'exit', code });
        resolve({ pid: proc.pid, exitCode: code });
      });
      proc.on('error', err => {
        activeProcesses.delete(proc.pid);
        event.sender.send('shell:output', { id, type: 'error', data: err.message });
        reject(err);
      });

      resolve({ pid: proc.pid });
    });
  });

  // ── Kill a running process ──
  ipcMain.handle('shell:kill', (_, pid) => {
    const proc = activeProcesses.get(pid);
    if (proc) { try { proc.kill(); } catch {} activeProcesses.delete(pid); }
  });

  // ── Open native terminal with a script ──
  ipcMain.handle('shell:open-terminal', async (_, { script, filename }) => {
    const tmpDir  = os.tmpdir();
    const ext     = process.platform === 'win32' ? '.bat' : '.sh';
    const tmpFile = path.join(tmpDir, filename + ext);

    // Make executable
    fs.writeFileSync(tmpFile, script, { encoding: 'utf8', mode: 0o755 });

    return new Promise((resolve) => {
      try {
        if (process.platform === 'darwin') {
          // Write AppleScript to file — avoids ALL shell quoting issues
          const osaFile = path.join(tmpDir, 'deftron-launch.scpt');
          // Escape the path for AppleScript (double-quote the backslashes)
          const safePath = tmpFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          fs.writeFileSync(osaFile,
            'tell application "Terminal"\n' +
            '  activate\n' +
            '  do script "bash \\"' + safePath + '\\""\n' +
            'end tell\n',
            'utf8'
          );
          const proc = spawn('osascript', [osaFile], { detached: true, stdio: 'ignore' });
          proc.unref();
          setTimeout(() => resolve({ success: true, path: tmpFile }), 800);

        } else if (process.platform === 'linux') {
          const candidates = [
            ['gnome-terminal', ['--', 'bash', tmpFile]],
            ['xterm',          ['-e', 'bash "' + tmpFile + '"']],
            ['konsole',        ['-e', 'bash "' + tmpFile + '"']],
            ['xfce4-terminal', ['-e', 'bash "' + tmpFile + '"']],
          ];
          let ok = false;
          for (const [term, args] of candidates) {
            try {
              const p = spawn(term, args, { detached: true, stdio: 'ignore' });
              p.unref(); ok = true; break;
            } catch {}
          }
          resolve({ success: ok, path: tmpFile });

        } else if (process.platform === 'win32') {
          const p = spawn('cmd.exe', ['/c', 'start', '', tmpFile], { detached: true, stdio: 'ignore' });
          p.unref();
          resolve({ success: true, path: tmpFile });
        } else {
          resolve({ success: false, error: 'Unsupported platform', path: tmpFile });
        }
      } catch (err) {
        resolve({ success: false, error: err.message, path: tmpFile });
      }
    });
  });

    // ── Check if a CLI tool is installed ──
  ipcMain.handle('shell:check-installed', async (_, tool) => {
    const cmd = process.platform === 'win32' ? `where ${tool}` : `which ${tool}`;
    try {
      const result = await runCmd(cmd);
      return { installed: true, path: result.trim() };
    } catch {
      return { installed: false };
    }
  });


  // ── Find openclaw binary (nvm-aware) ──────────────────────────────────────
  ipcMain.handle('shell:find-openclaw', async () => {
    const { execSync } = require('child_process');
    const home = os.homedir();

    // Try multiple strategies
    const strategies = [
      // 1. nvm bin scan — look for FILE in bin/, not module directory
      () => {
        const nvmDir = path.join(home, '.nvm', 'versions', 'node');
        if (!fs.existsSync(nvmDir)) return null;
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        for (const v of versions) {
          const p = path.join(nvmDir, v, 'bin', 'openclaw');
          if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        }
        return null;
      },
      // 2. which command with login shell
      () => {
        try { return execSync('/bin/bash -lc "which openclaw"', {timeout:3000}).toString().trim() || null; }
        catch { return null; }
      },
      // 3. common locations
      () => {
        for (const p of [
          '/usr/local/bin/openclaw',
          path.join(home, '.local', 'bin', 'openclaw'),
          '/opt/homebrew/bin/openclaw',
        ]) { if (fs.existsSync(p)) return p; }
        return null;
      },
    ];

    for (const fn of strategies) {
      try {
        const result = fn();
        if (result && fs.existsSync(result)) {
          return { found: true, path: result };
        }
      } catch {}
    }
    return { found: false };
  });

  // ── Write agent config file ───────────────────────────────────────────────
  ipcMain.handle('shell:write-agent-config', async (_, { agent, config }) => {
    const home = os.homedir();
    const dirs = {
      openclaw: [path.join(home, '.openclaw'), path.join(home, '.config', 'openclaw')],
      hermes:   [path.join(home, '.hermes'),   path.join(home, '.config', 'hermes')],
    };
    const targets = dirs[agent] || [];
    for (const dir of targets) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
        return { success: true, path: path.join(dir, 'config.json') };
      } catch {}
    }
    return { success: false, error: 'Could not write config' };
  });

  // ── Run a single command and return full output ───────────────────────────
  ipcMain.handle('shell:run-quick', async (_, cmd) => {
    return new Promise(resolve => {
      const proc = spawn('/bin/bash', ['-lc', cmd], { env: { ...process.env, HOME: os.homedir() } });
      let out = '', err = '';
      proc.stdout.on('data', d => out += d.toString());
      proc.stderr.on('data', d => err += d.toString());
      proc.on('close', code => resolve({ code, stdout: out.trim(), stderr: err.trim() }));
      setTimeout(() => { proc.kill(); resolve({ code: -1, stdout: out.trim(), stderr: 'timeout' }); }, 8000);
    });
  });

  // ── HTTP ping an agent endpoint (no CORS in Electron!) ──
  ipcMain.handle('agent:ping', (_, url) => {
    return new Promise(resolve => {
      const parsed  = new URL(url);
      const lib     = parsed.protocol === 'https:' ? https : http;
      const timeout = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 4000);

      const req = lib.request({
        host:    parsed.hostname,
        port:    parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:    parsed.pathname || '/status',
        method:  'GET',
        timeout: 3500,
      }, res => {
        clearTimeout(timeout);
        resolve({ ok: res.statusCode < 400, status: res.statusCode });
      });

      req.on('error', err => { clearTimeout(timeout); resolve({ ok: false, error: err.message }); });
      req.end();
    });
  });

  // ── Send a chat message to a network agent (no CORS!) ──
  ipcMain.handle('agent:chat', (_, { url, body, apiKey }) => {
    return new Promise((resolve, reject) => {
      const parsed  = new URL(url);
      const lib     = parsed.protocol === 'https:' ? https : http;
      const payload = JSON.stringify(body);

      const headers = {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const req = lib.request({
        host:   parsed.hostname,
        port:   parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:   parsed.pathname,
        method: 'POST',
        headers,
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(data) }); }
          catch { resolve({ ok: true, data }); }
        });
      });

      req.on('error', err => reject(err));
      req.setTimeout(30000, () => req.destroy(new Error('Request timeout')));
      req.write(payload);
      req.end();
    });
  });

  // ── Save / load persistent settings ──
  const settingsPath = path.join(app.getPath('userData'), 'deftron-settings.json');

  ipcMain.handle('settings:load', () => {
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch {}
    return null;
  });

  ipcMain.handle('settings:save', (_, data) => {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Show save dialog for scripts ──
  ipcMain.handle('dialog:save-file', async (_, { defaultName, content }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(os.homedir(), 'Downloads', defaultName),
      filters: [
        { name: 'Shell Scripts', extensions: ['sh', 'bat'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, content, { encoding: 'utf8', mode: 0o755 });
      return { ok: true, path: result.filePath };
    }
    return { ok: false };
  });
  // (continued below)

// ─── Helpers ─────────────────────────────────────────────────────────────────
  // ── Anthropic API call (from main process — bypasses renderer CORS/CSP) ──
  ipcMain.handle('api:anthropic', (_, { apiKey, body }) => {
    return new Promise((resolve) => {
      const payload = JSON.stringify(body);
      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(data) }); }
          catch (e) { resolve({ ok: false, error: 'Invalid JSON: ' + data.slice(0, 200) }); }
        });
      });
      req.on('error', err => resolve({ ok: false, error: err.message }));
      req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout after 30s' }); });
      req.write(payload);
      req.end();
    });
  });

  // ── Generic HTTPS POST (for OpenRouter, Groq, OpenAI, etc.) ────────────────
  ipcMain.handle('api:post', (_, { url, headers, body }) => {
    return new Promise((resolve) => {
      const payload = JSON.stringify(body);
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      };
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(data) }); }
          catch (e) { resolve({ ok: false, error: 'Parse error: ' + data.slice(0, 200) }); }
        });
      });
      req.on('error', err => resolve({ ok: false, error: err.message }));
      req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
      req.write(payload);
      req.end();
    });
  });




  // ── Remote agent connections ─────────────────────────────────────────────
  // SSH: run a command on a remote machine
  ipcMain.handle('remote:ssh', async (_, { host, port, user, keyPath, password, command, timeout }) => {
    return new Promise((resolve) => {
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=8',
        '-o', 'BatchMode=yes',
        '-p', String(port || 22),
      ]
      if (keyPath) sshArgs.push('-i', keyPath)
      sshArgs.push(`${user}@${host}`, command)

      const proc = spawn('ssh', sshArgs, { stdio: ['pipe','pipe','pipe'] })
      let stdout = '', stderr = ''
      proc.stdout.on('data', d => stdout += d.toString())
      proc.stderr.on('data', d => stderr += d.toString())
      proc.on('exit', code => resolve({ ok: code === 0, stdout, stderr, code }))
      proc.on('error', e => resolve({ ok: false, error: e.message }))
      setTimeout(() => { proc.kill(); resolve({ ok: false, error: 'SSH timeout' }) }, (timeout || 30) * 1000)
    })
  })

  // HTTP: call a remote agent HTTP endpoint
  ipcMain.handle('remote:http', async (_, { url, method, headers, body, timeout }) => {
    return new Promise((resolve) => {
      const parsed = new URL(url)
      const payload = body ? JSON.stringify(body) : ''
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: method || 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      }
      const lib = parsed.protocol === 'https:' ? https : http
      const req = lib.request(options, res => {
        let data = ''
        res.on('data', d => data += d)
        res.on('end', () => {
          try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(data) }) }
          catch { resolve({ ok: res.statusCode < 400, status: res.statusCode, data }) }
        })
      })
      req.on('error', e => resolve({ ok: false, error: e.message }))
      req.setTimeout((timeout || 30) * 1000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }) })
      if (payload) req.write(payload)
      req.end()
    })
  })

  // SSH test connection
  ipcMain.handle('remote:ssh-test', async (_, { host, port, user, keyPath }) => {
    return new Promise((resolve) => {
      const args = ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', '-p', String(port || 22)]
      if (keyPath) args.push('-i', keyPath)
      args.push(`${user}@${host}`, 'echo DEFTRON_OK')
      const proc = spawn('ssh', args, { stdio: ['pipe','pipe','pipe'] })
      let out = ''
      proc.stdout.on('data', d => out += d.toString())
      proc.on('exit', code => resolve({ ok: out.includes('DEFTRON_OK'), code }))
      proc.on('error', e => resolve({ ok: false, error: e.message }))
      setTimeout(() => { proc.kill(); resolve({ ok: false, error: 'Timeout' }) }, 8000)
    })
  })

  // List SSH keys from ~/.ssh
  ipcMain.handle('remote:list-keys', () => {
    const sshDir = path.join(os.homedir(), '.ssh')
    if (!fs.existsSync(sshDir)) return { keys: [] }
    const keys = fs.readdirSync(sshDir)
      .filter(f => !f.endsWith('.pub') && !f.endsWith('known_hosts') && !f.endsWith('config') && !f.startsWith('.'))
      .map(f => path.join(sshDir, f))
    return { keys }
  })

  // ── Embedded terminal (PTY via script command on macOS) ─────────────────
  const termProcs = new Map() // termId -> { proc, onData }

  ipcMain.handle('term:create', (_, { termId, command }) => {
    const home = os.homedir()
    // Kill any existing terminal with this ID
    if (termProcs.has(termId)) {
      try { termProcs.get(termId).proc.kill() } catch {}
      termProcs.delete(termId)
    }

    // Write the full command to a temp shell script — avoids all quoting/escaping issues
    const tmpScript = path.join(os.tmpdir(), `deftron-${termId}.sh`)
    const scriptContent = [
      '#!/bin/bash',
      `export NVM_DIR="${home}/.nvm"`,
      `[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"`,
      `export PATH="${home}/.hermes/bin:${home}/.local/bin:$PATH"`,
      '',
      command,
    ].join('\n')
    fs.writeFileSync(tmpScript, scriptContent, { mode: 0o755 })

    // Spawn bash directly — script command requires a real TTY which we don't have
    const proc = spawn('/bin/bash', [tmpScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb', FORCE_COLOR: '0', NO_COLOR: '1', PYTHONUNBUFFERED: '1' }
    })

    // Buffer ALL output so late subscribers get the full history
    const entry = { proc, callbacks: [], outputBuffer: '' }
    termProcs.set(termId, entry)

    const handleData = (data) => {
      const txt = data.toString()
      entry.outputBuffer += txt
      // Keep buffer manageable
      if (entry.outputBuffer.length > 50000) entry.outputBuffer = entry.outputBuffer.slice(-40000)
      entry.callbacks.forEach(cb => cb(txt))
    }

    proc.stdout.on('data', handleData)
    proc.stderr.on('data', handleData)
    proc.on('exit', (code) => {
      handleData(`\n[process exited with code ${code}]\n`)
      termProcs.delete(termId)
    })
    proc.on('error', (err) => {
      handleData(`\n[error: ${err.message}]\n`)
    })

    return { ok: true }
  })

  ipcMain.handle('term:write', (_, { termId, data }) => {
    const entry = termProcs.get(termId)
    if (entry && entry.proc.stdin.writable) {
      entry.proc.stdin.write(data)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle('term:kill', (_, termId) => {
    const entry = termProcs.get(termId)
    if (entry) {
      try { entry.proc.kill() } catch {}
      termProcs.delete(termId)
    }
    return { ok: true }
  })

  ipcMain.on('term:subscribe', (event, termId) => {
    const entry = termProcs.get(termId)
    if (entry) {
      const cb = (data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(`term:data:${termId}`, data)
        }
      }
      entry.callbacks.push(cb)
      // Replay buffered output so subscriber sees everything that happened before subscribing
      if (entry.outputBuffer && !event.sender.isDestroyed()) {
        event.sender.send(`term:data:${termId}`, entry.outputBuffer)
      }
    }
  })

  // ── Agent process management ─────────────────────────────────────────────
  const agentProcs = new Map() // agentId -> { proc, buffer, resolve, timer }

  function stripAnsi(str) {
    return str.replace(/\[[0-9;]*[mGKHFABCDJnsu]/g, '').replace(/\][^]*/g, '')
  }

  function findBinary(name) {
    const home = os.homedir()
    // Strategy 1: scan nvm bin directories (most reliable for nvm users)
    const nvmVersions = path.join(home, '.nvm', 'versions', 'node')
    if (fs.existsSync(nvmVersions)) {
      try {
        const versions = fs.readdirSync(nvmVersions).sort().reverse()
        for (const v of versions) {
          const p = path.join(nvmVersions, v, 'bin', name)
          // Use lstatSync to handle symlinks (don't follow with isFile)
          try {
            fs.lstatSync(p) // throws if not exists
            return p // exists (file or symlink) — good
          } catch {}
        }
      } catch {}
    }
    // Strategy 2: common install locations
    const candidates = [
      path.join(home, '.hermes', 'bin', name),
      path.join(home, '.local', 'bin', name),
      `/usr/local/bin/${name}`,
      `/opt/homebrew/bin/${name}`,
      `/opt/homebrew/sbin/${name}`,
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
    // Strategy 3: try shell which command
    try {
      const { execSync } = require('child_process')
      const result = execSync(
        `export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; which ${name} 2>/dev/null`,
        { shell: '/bin/bash', timeout: 3000 }
      ).toString().trim()
      if (result) return result
    } catch {}
    return name // last resort
  }

  ipcMain.handle('agent:spawn', async (_, { agentId, agentType }) => {
    // Kill any existing process
    if (agentProcs.has(agentId)) {
      try { agentProcs.get(agentId).proc.kill('SIGTERM') } catch {}
      agentProcs.delete(agentId)
    }

    const home = os.homedir()
    const nvmDir = path.join(home, '.nvm')
    const binary = findBinary(agentType === 'clawdbot' ? 'openclaw' : 'hermes')

    // Load NVM and launch in interactive mode
    const shellCmd = `export NVM_DIR="${nvmDir}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; export PATH="$HOME/.hermes/bin:$HOME/.local/bin:$PATH"; exec "${binary}"`

    const proc = spawn('/bin/bash', ['-lc', shellCmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '0', NO_COLOR: '1' }
    })

    const entry = { proc, buffer: '', resolve: null, timer: null, started: false, startBuffer: '' }
    agentProcs.set(agentId, entry)

    proc.stdout.on('data', data => {
      const text = stripAnsi(data.toString())
      const e = agentProcs.get(agentId)
      if (!e) return
      if (!e.started) { e.startBuffer += text; return }
      e.buffer += text
      if (e.resolve) {
        if (e.timer) clearTimeout(e.timer)
        e.timer = setTimeout(() => {
          const resp = e.buffer.trim()
          e.buffer = ''
          e.timer = null
          const res = e.resolve; e.resolve = null
          res({ ok: true, response: resp })
        }, 1800)
      }
    })

    proc.stderr.on('data', data => {
      const text = stripAnsi(data.toString())
      const e = agentProcs.get(agentId)
      if (!e) return
      if (!e.started) { e.startBuffer += text; return }
      e.buffer += text
    })

    proc.on('exit', code => {
      const e = agentProcs.get(agentId)
      if (e?.resolve) e.resolve({ ok: false, error: `Process exited (code ${code})` })
      agentProcs.delete(agentId)
    })

    proc.on('error', err => {
      const e = agentProcs.get(agentId)
      if (e?.resolve) e.resolve({ ok: false, error: err.message })
    })

    // Wait for startup - check multiple times
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (!agentProcs.has(agentId)) {
        return { ok: false, error: `${binary} exited immediately — is it installed? Try: find ~/.nvm -name "${name}" -path "*/bin/*"`, binary }
      }
    }

    const e = agentProcs.get(agentId)
    if (e) {
      e.started = true
      e.buffer = '' // clear startup noise
    }

    return { ok: true, binary, startOutput: e ? e.startBuffer.slice(0, 200) : '' }
  })

  ipcMain.handle('agent:message', (_, { agentId, message, timeout }) => {
    const e = agentProcs.get(agentId)
    if (!e || !e.proc.stdin.writable) return Promise.resolve({ ok: false, error: 'Agent not running — click LAUNCH to start it' })

    return new Promise(resolve => {
      e.buffer = ''
      e.resolve = resolve
      if (e.timer) clearTimeout(e.timer)

      try {
        e.proc.stdin.write(message + '\n')
      } catch (err) {
        resolve({ ok: false, error: 'Could not send message: ' + err.message })
        return
      }

      // Hard timeout
      setTimeout(() => {
        if (e.resolve === resolve) {
          const resp = e.buffer.trim()
          e.buffer = ''; e.resolve = null
          if (e.timer) clearTimeout(e.timer)
          resolve({ ok: true, response: resp || '(no response — agent may be processing, try again)' })
        }
      }, timeout || 25000)
    })
  })

  ipcMain.handle('agent:status', (_, agentId) => ({
    running: agentProcs.has(agentId) && !agentProcs.get(agentId).proc.killed
  }))

  ipcMain.handle('agent:kill', (_, agentId) => {
    if (agentProcs.has(agentId)) {
      try { agentProcs.get(agentId).proc.kill('SIGTERM') } catch {}
      agentProcs.delete(agentId)
    }
    return { ok: true }
  })


} // end setupIPC
function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout || stderr);
    });
  });
}
