# Bantuity Desktop

Windows application for **Copilot** (AI-assisted Stata analysis) and **Plotex** (publication figures). Stata runs on the user’s machine under their license.

## Download

**Installer:**  
https://github.com/Pakang619/bantuity-desktop/releases/latest/download/Bantuity-Setup.exe

**Releases:**  
https://github.com/Pakang619/bantuity-desktop/releases/latest

## Requirements

| Requirement | Detail |
|-------------|--------|
| Operating system | Windows 10 or 11, 64-bit |
| Stata | Licensed Stata 17 or later installed on the same computer |
| Network | Internet for AI generation, interpretation, and figure services |
| Optional | Python 3.10+ if the environment is not already available (the app can set up a local service environment) |

**Yes — the app is intended to run on any Windows PC that has a valid Stata license.** Analysis does not require a cloud Stata license; execution uses the user’s local Stata installation.

## Features

- **Copilot** — natural language to do-files, local Stata runs, dashboard results and figures  
- **Plotex** — journal themes, designer, and figure provenance  
- **Local Stata service** — jobs stay on the PC under the user’s license  
- **MCP** (optional) — IDE tools can use the same projects and Stata service  

## Develop

```powershell
cd bantuity-desktop
npm install
npm run bundle:web
npm start
```

## Build installer

```powershell
npm run dist
```

Output: `dist/Bantuity-Setup-<version>.exe`

## Architecture

```
Electron shell
  ├─ Plotex UI (local static)
  ├─ Copilot UI (local static)
  └─ Stata service → %LOCALAPPDATA%\Bantuity\StataConnector
```

Settings: `%APPDATA%\bantuity-desktop\settings.json`
