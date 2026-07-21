# Bantuity Desktop

One Windows app for **Plotex** and **Copilot** — no browser required for the UI.

## Download (public)

**Installer:**  
https://github.com/Pakang619/bantuity-desktop/releases/latest/download/Bantuity-Setup.exe

**Release page:**  
https://github.com/Pakang619/bantuity-desktop/releases/latest

Double-click the EXE (~71 MB). Windows SmartScreen may warn on unsigned builds → **More info → Run anyway**.

## What you get

| Piece | Offline? | Notes |
|--------|----------|--------|
| Plotex UI | Yes | Bundled static Next.js export |
| Copilot UI | Yes | Bundled static Next.js export (includes **MCP** how-to) |
| Cloud APIs | No | Still calls Plotex / Copilot backends |
| Local Stata service | Bundled in the app | Auto-starts; needs licensed Stata 17+ on the PC |
| MCP for IDEs | External package | Claude Code, Cursor, Codex, Grok → same API + this Stata service |

### MCP (Claude Code, Cursor, Codex, Grok, …)

Coding tools can drive Copilot through the **Bantuity MCP** server while this app’s Stata service executes jobs:

1. Keep **Start** (Stata service) running in Bantuity Desktop  
2. Install MCP once: `cd stata-copilot\mcp` → `pip install -e .` → command `bantuity-mcp`  
3. Wire your host (see sidebar **MCP · coding tools**, or https://copilot.bantuity.com/mcp )  

Repo package: https://github.com/Pakang619/stata-copilot/tree/master/mcp

## Develop

```powershell
cd C:\Users\Deriv\Desktop\bantuity-desktop
npm install
# Bundle latest web UIs into apps/
npm run bundle:web
npm start
```

## Build installer

```powershell
# Full: rebuild web + portable EXE
npm run dist:portable

# Or after bundle:web already ran:
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
npx electron-builder --win portable --config.win.signAndEditExecutable=false
```

Output: `dist\Bantuity-Setup-1.0.0.exe`

Publish a new GitHub release:

```powershell
gh release create v1.0.1 dist/Bantuity-Setup-1.0.0.exe --title "Bantuity Desktop 1.0.1" --notes "..."
```

## Architecture

```
Electron shell (sidebar)
  ├─ local static server :39201 → apps/plotex
  ├─ local static server :39202 → apps/copilot
  └─ connector manager → %LOCALAPPDATA%\Bantuity\*Connector
```

Settings: `%APPDATA%\bantuity-desktop\settings.json`
