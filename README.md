# DEFTRON v1.0 — Desktop App

**Multi-agent AI command center. Install and run OpenClaw + Hermes agents directly from the UI.**

![DEFTRON](assets/screenshot.png)

## What it is

DEFTRON is an Electron desktop app that lets you:
- **Install OpenClaw** (openclaw.ai) and **Hermes** (NousResearch) agents directly from the UI
- Run agent install scripts in a real native terminal (Terminal.app / gnome-terminal / Windows Terminal)
- Chat with multiple AI agents simultaneously, with automatic task routing
- Add LAN/network agents running on other machines
- Full theme customization, WhisperFlow voice input, and persistent settings

---

## Quick Start

### Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Git** — [git-scm.com](https://git-scm.com)
- An **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/your-username/deftron.git
cd deftron

# Install dependencies
npm install

# Start in development mode
npm run dev
```

This opens DEFTRON as a desktop window. The app auto-reloads on changes.

### Build for Distribution

```bash
# Build for your current platform
npm run build

# Platform-specific
npm run build:mac    # .dmg for macOS
npm run build:win    # .exe installer for Windows
npm run build:linux  # .AppImage for Linux
```

Built apps appear in `dist-app/`.

---

## Installing Agents from the UI

1. Click **+ ADD AGENT** in the sidebar
2. Choose **Install OpenClaw** or **Install Hermes**
3. The install wizard opens — your platform is auto-detected
4. For each step you can:
   - **▶ RUN** — executes the command in real-time, streams output to the terminal emulator
   - **COPY** — copy the command to clipboard
   - **⊞ OPEN IN TERMINAL** — writes a shell script and launches it in your native terminal
5. After installation, click **PING AGENT** to verify the agent is running
6. Click **ADD TO DEFTRON** to connect it

### What gets installed

**OpenClaw** (`npm install -g openclaw`)
- Installs the OpenClaw personal agent framework
- Runs `openclaw onboard` — interactive setup wizard for your AI provider
- Starts `npx openclaw-bridge --port 3001` — HTTP bridge for DEFTRON to communicate with

**Hermes** (`curl ... | bash`)
- Installs NousResearch's Hermes Agent (Python-based)
- Runs `hermes setup` — configures model provider (OpenRouter, Anthropic, etc.)
- Starts `hermes gateway start --http --port 3002` — HTTP gateway for DEFTRON

---

## Configuration

### API Keys (Settings → Keys)

| Key | Used For |
|-----|----------|
| **WhisperFlow Key** | OpenAI Whisper-1 API for voice transcription |
| **OpenRouter Key** | Access 200+ models (includes Hermes 3 405B) |
| **Groq API Key** | Fast Nous-Hermes 2 and Llama 3.1 inference |
| **OpenAI Key** | GPT models, Whisper |
| **ElevenLabs Key** | Text-to-speech (future feature) |
| **Ollama Endpoint** | Local Ollama instance (default: localhost:11434) |

Settings are automatically saved to your user data directory and persist across launches.

### Agent Modes

| Mode | Description |
|------|-------------|
| `claude-api` | Direct Anthropic API |
| `claude-persona` | Claude simulating the agent persona |
| `openrouter` | 200+ models via OpenRouter |
| `groq-nous` | Nous-Hermes 2 on Groq (fast) |
| `groq-llama` | Llama 3.1 70B on Groq |
| `ollama` | Local Ollama model |
| `openclaw-net` | OpenClaw running locally or on LAN |
| `hermes-net` | Hermes running locally or on LAN |
| `network` | Custom HTTP POST endpoint |

---

## Network Agents (LAN / Remote Machines)

Run agents on any machine on your network and connect to them from DEFTRON.

### OpenClaw on a remote machine

```bash
# On the remote machine
npm install -g openclaw
openclaw onboard
npx openclaw-bridge --port 3001
```

Then in DEFTRON Settings → Network: set the endpoint to `http://<machine-ip>:3001/chat`

### Hermes on a remote machine

```bash
# On the remote machine
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc
hermes setup
hermes gateway start --http --port 3002
```

Then in DEFTRON Settings → Network: set the endpoint to `http://<machine-ip>:3002/chat`

### Migrate from OpenClaw to Hermes

```bash
hermes claw migrate          # Interactive full migration
hermes claw migrate --dry-run  # Preview what would be migrated
```

Migrates: SOUL.md, memories, skills, API keys, messaging configs.

---

## Agent Types

### 🦞 ClawdBot (OpenClaw type)
- Personality-driven personal assistant
- Direct, witty, memory-first
- Can do things: browse web, run commands, manage files, build skills
- Based on OpenClaw framework (openclaw.ai)

### ☤ Hermes (Hermes type)
- Precision execution agent
- Structured, actionable, business-focused
- Self-improving: creates skills from experience
- Supports cron scheduling and sub-agents
- Based on NousResearch Hermes Agent

---

## Project Structure

```
deftron-desktop/
├── electron/
│   ├── main.js          # Main process: windows, IPC, tray, native OS
│   └── preload.js       # Secure bridge: exposes window.deftron API
├── src/
│   ├── main.jsx         # React entry point
│   ├── index.html       # HTML template with CSP
│   └── App.jsx          # Full DEFTRON UI
├── assets/
│   ├── icon.png         # 512×512 app icon
│   ├── icon.icns        # macOS icon
│   ├── icon.ico         # Windows icon
│   └── tray-icon.png    # 16×16 tray icon
├── package.json         # Dependencies + electron-builder config
├── vite.config.js       # Vite + React build
└── README.md
```

---

## The window.deftron API

The `window.deftron` object is available in the renderer and provides native capabilities:

```js
// Run a shell command and stream output
await window.deftron.runCommand('npm install -g openclaw', 'install-id')
window.deftron.onOutput(({ type, data }) => console.log(type, data))

// Open native terminal with a script
await window.deftron.openTerminal('#!/bin/bash\n...', 'install-openclaw')

// Check if a tool is installed
const { installed } = await window.deftron.checkInstalled('openclaw')

// Ping a network agent (no CORS!)
const { ok } = await window.deftron.pingAgent('http://localhost:3001/status')

// Chat with a network agent (no CORS!)
const { data } = await window.deftron.chatWithAgent('http://localhost:3001/chat', { message: 'hello' })

// Persistent settings
await window.deftron.saveSettings({ portalName: 'DEFTRON', ... })
const settings = await window.deftron.loadSettings()

// Native file save dialog
await window.deftron.saveFile('install.sh', '#!/bin/bash\n...')
```

---

## Contributing

PRs welcome. To contribute:

```bash
git clone https://github.com/your-username/deftron.git
cd deftron
npm install
npm run dev
```

---

## Links

- [OpenClaw](https://openclaw.ai) · [Docs](https://docs.openclaw.ai) · [GitHub](https://github.com/openclaw/openclaw)
- [Hermes Agent](https://hermes-agent.nousresearch.com) · [GitHub](https://github.com/NousResearch/hermes-agent)
- [OpenRouter](https://openrouter.ai) · [Groq](https://console.groq.com) · [Ollama](https://ollama.ai)

---

**DEFTRON v1.0 © 2025**
