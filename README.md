# Bantuity Desktop

One Windows app for **Plotex** and **Copilot** — no browser required for the UI.

## Download (public)

**Installer:**  
https://github.com/Pakang619/bantuity-desktop/releases/latest/download/Bantuity-Setup-1.0.0.exe

**Release page:**  
https://github.com/Pakang619/bantuity-desktop/releases/latest

Double-click the EXE (~71 MB). Windows SmartScreen may warn on unsigned builds → **More info → Run anyway**.

## What you get

| Piece | Offline? | Notes |
|--------|----------|--------|
| Plotex UI | Yes | Bundled static Next.js export |
| Copilot UI | Yes | Bundled static Next.js export |
| Cloud APIs | No | Still calls Plotex / Copilot backends |
| Local Stata | Local only | Use **Start connector** after installing the Stata connector once |

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
