# Bantuity Desktop

One Windows desktop app for **Plotex** and **Copilot** — no browser required for day-to-day use.

- Switch products from the left sidebar  
- Workspaces open in a native window  
- Optional **local Stata connector** start/stop from the same app  
- APIs stay in the cloud; Stata stays on your PC  

## Requirements

- Windows 10/11  
- For live Stata runs: licensed Stata 17+ and the Bantuity Stata connector (download once from Plotex or Copilot)  

## Develop

```powershell
cd C:\Users\Deriv\Desktop\bantuity-desktop
npm install
npm start
```

## Build installer (NSIS)

```powershell
cd C:\Users\Deriv\Desktop\bantuity-desktop
npm install
npm run dist
```

Output: `dist\Bantuity Setup 1.0.0.exe` (one-click install, Desktop + Start Menu shortcuts).

Portable build:

```powershell
npm run dist:portable
```

## Settings

Stored under `%APPDATA%\bantuity-desktop\settings.json`.

You can override product URLs (e.g. local dev):

```json
{
  "products": {
    "plotex": { "url": "http://127.0.0.1:3100", "workspaceUrl": "http://127.0.0.1:3100/workspace" },
    "copilot": { "url": "http://127.0.0.1:3000", "workspaceUrl": "http://127.0.0.1:3000/workspace" }
  }
}
```

## Architecture

| Layer | Where |
|--------|--------|
| UI shell | Electron (this repo) |
| Plotex / Copilot pages | Existing web apps (production or local) |
| APIs | Render / local FastAPI |
| Stata | Local connector process managed by the shell |

The shell does **not** reimplement Plotex or Copilot — it hosts them as first-class desktop surfaces so non-technical users never open Chrome or a terminal.
