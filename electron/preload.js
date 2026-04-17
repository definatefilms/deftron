const { contextBridge, ipcRenderer } = require('electron');

// ─── DEFTRON Native API ───────────────────────────────────────────────────────
// Exposed to the renderer process as window.deftron
contextBridge.exposeInMainWorld('deftron', {

  // ── Platform / System ──
  platform:    () => ipcRenderer.invoke('app:platform'),
  homeDir:     () => ipcRenderer.invoke('app:home-dir'),
  version:     () => ipcRenderer.invoke('app:version'),
  openExternal:(url) => ipcRenderer.invoke('app:open-external', url),
  notify:      (title, body) => ipcRenderer.invoke('app:notify', { title, body }),

  // ── Shell / Terminal ──
  // Run a command and stream output events
  runCommand: (command, id) =>
    ipcRenderer.invoke('shell:run', { command, id }),

  // Kill a running command by PID
  killCommand: (pid) =>
    ipcRenderer.invoke('shell:kill', pid),

  // Open native terminal (Terminal.app / gnome-terminal / cmd) with a script
  openTerminal: (script, filename) =>
    ipcRenderer.invoke('shell:open-terminal', { script, filename }),

  // Check if a CLI tool is installed (e.g., 'openclaw', 'hermes', 'node', 'python3')
  // Remote agents
  sshRun:      (cfg) => ipcRenderer.invoke('remote:ssh', cfg),
  sshTest:     (cfg) => ipcRenderer.invoke('remote:ssh-test', cfg),
  httpAgent:   (cfg) => ipcRenderer.invoke('remote:http', cfg),
  listSshKeys: ()    => ipcRenderer.invoke('remote:list-keys'),
  createTerm:  (termId, command) => ipcRenderer.invoke('term:create', { termId, command }),
  writeTerm:   (termId, data)    => ipcRenderer.invoke('term:write', { termId, data }),
  killTerm:    (termId)          => ipcRenderer.invoke('term:kill', termId),
  subscribeTerm: (termId, cb) => {
    ipcRenderer.send('term:subscribe', termId)
    const handler = (_, data) => cb(data)
    ipcRenderer.on(`term:data:${termId}`, handler)
    return () => ipcRenderer.removeListener(`term:data:${termId}`, handler)
  },
  spawnAgent:      (agentId, agentType) => ipcRenderer.invoke('agent:spawn', { agentId, agentType }),
  messageAgent:    (agentId, message, timeout) => ipcRenderer.invoke('agent:message', { agentId, message, timeout }),
  agentStatus:     (agentId) => ipcRenderer.invoke('agent:status', agentId),
  killAgent:       (agentId) => ipcRenderer.invoke('agent:kill', agentId),
  callAnthropic:   (apiKey, body)  => ipcRenderer.invoke('api:anthropic', { apiKey, body }),
  apiPost:         (url, headers, body) => ipcRenderer.invoke('api:post', { url, headers, body }),
  findOpenClaw:    ()             => ipcRenderer.invoke('shell:find-openclaw'),
  writeAgentConfig:(agent, config) => ipcRenderer.invoke('shell:write-agent-config', { agent, config }),
  runQuick:        (cmd)           => ipcRenderer.invoke('shell:run-quick', cmd),
  checkInstalled: (tool) =>
    ipcRenderer.invoke('shell:check-installed', tool),

  // Listen for streaming shell output
  onOutput: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('shell:output', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('shell:output', handler);
  },

  // ── Network Agent (CORS-free via main process) ──
  pingAgent: (url) =>
    ipcRenderer.invoke('agent:ping', url),

  chatWithAgent: (url, body, apiKey) =>
    ipcRenderer.invoke('agent:chat', { url, body, apiKey }),

  // ── Settings persistence ──
  loadSettings: () =>
    ipcRenderer.invoke('settings:load'),

  saveSettings: (data) =>
    ipcRenderer.invoke('settings:save', data),

  // ── File dialogs ──
  saveFile: (defaultName, content) =>
    ipcRenderer.invoke('dialog:save-file', { defaultName, content }),

  // ── Menu events from main process ──
  onMenu: (channel, callback) => {
    const validChannels = ['menu:clear-memory', 'menu:install'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => callback(data));
    }
  },

  // ── Electron environment flag ──
  isElectron: true,
});
