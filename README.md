# Bantuity Studio Light

**Bantuity Studio Light** (also known as **Studio Light**) — **Beta**

Windows desktop application for **Copilot** (AI-assisted Stata analysis) and **Plotex** (publication figures). Stata runs on the user’s machine under their license.

## Download (Beta)

https://github.com/Pakang619/bantuity-desktop/releases/latest/download/Bantuity-Setup.exe

Installer product name: **Bantuity Studio Light**. Start menu / desktop shortcut: **Bantuity Studio Light**.

## What’s inside

- **Copilot** — natural-language analysis, local do-file runs, results dashboard  
- **Plotex** — journal themes, designer, and figure provenance  
- **Local Stata service** — shared by Copilot, Plotex, and optional MCP tools  

## Develop

```bash
npm install
npm start
```

### Package installer

```bash
npm run dist
```

Output: `dist/Bantuity-Setup-<version>.exe`  
Display name in Windows: **Bantuity Studio Light** (Beta branding in shell UI).

### Layout

```
bantuity-desktop/
  ├─ Plotex UI (local static)
  ├─ Copilot UI (local static)
  └─ Stata service → %LOCALAPPDATA%\Bantuity\StataConnector
```

## Branding

| Field | Value |
|--------|--------|
| Full name | Bantuity Studio Light |
| Known as | Studio Light |
| Stage | Beta |
| Modules | Plotex, Copilot |

Technical IDs (`com.bantuity.desktop`, LocalAppData folders) stay stable so upgrades do not break existing installs.
