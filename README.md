# Minz Mahallu Management System — React + Electron Edition

A modern desktop application for managing mosque community (mahallu) administration,
built with **React + TypeScript + Electron + Tailwind CSS + SQLite**.

This is a complete rewrite of the original Qt/QML version with the same functionality,
but using a modern web-based UI stack.

## Features

- **16 modules**: Dashboard, Families, Members, Subscriptions, Donations, Accounting,
  Marriage Register, Death Register, Welfare, Certificates, Tokens, Reports, Settings,
  Users, Audit Log, Backup & Restore
- **Modern UI**: Tailwind CSS + custom theme system (light/dark)
- **Bilingual**: English + Malayalam (മലയാളം) with live switching
- **Secure auth**: PBKDF2-SHA256 password hashing (200,000 iterations)
- **Fast**: Synchronous SQLite via better-sqlite3 (no IPC roundtrips for DB ops)
- **Cross-platform**: Windows, macOS, Linux builds via GitHub Actions
- **Charts**: Recharts for dashboard visualizations

## Tech Stack

| Layer | Technology |
|-------|------------|
| Renderer | React 18 + TypeScript + Vite |
| Desktop | Electron 33 |
| Database | SQLite via better-sqlite3 |
| Styling | Tailwind CSS 3 |
| Icons | lucide-react |
| Charts | recharts |
| State | Zustand |
| Routing | react-router-dom (HashRouter) |
| i18n | Custom store (no library) |

## Project Structure

```
minzmahallu-electron/
├── electron/                  # Main process (Node.js)
│   ├── main.ts                # Window + IPC handlers
│   ├── preload.ts             # Context bridge (window.mms API)
│   ├── db/
│   │   └── connection.ts      # SQLite connection + migrations
│   └── services/
│       ├── auth.service.ts    # PBKDF2 password verification
│       └── data.service.ts    # All 16 modules' CRUD + aggregations
├── src/                       # Renderer (React)
│   ├── App.tsx                # Routes + layout
│   ├── main.tsx               # Entry point
│   ├── components/
│   │   ├── ui/               # Button, Card, Input, Dialog, etc.
│   │   ├── layout/            # Sidebar + Topbar
│   │   ├── DataTable.tsx     # Generic table with pagination
│   │   └── ToastContainer.tsx
│   ├── pages/                 # 16 page components
│   ├── hooks/
│   │   └── useList.ts        # Pagination + search hook
│   ├── lib/
│   │   ├── auth.ts            # Auth state (Zustand)
│   │   ├── theme.ts           # Theme state (light/dark)
│   │   ├── toast.ts           # Toast notifications
│   │   └── utils.ts           # Helpers (formatCurrency, etc.)
│   ├── i18n/
│   │   └── index.ts           # English + Malayalam translations
│   └── styles/
│       └── globals.css        # Tailwind + CSS variables
├── resources/
│   ├── sql/                   # Schema + seed + migrations
│   └── templates/             # Certificate HTML templates
└── .github/workflows/         # CI build
```

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (Vite + Electron together)
npm run dev

# Build for production
npm run build

# Package for current OS
npm run package

# Package for Windows
npm run package:win
```

## Architecture

```
┌─────────────────────────────────────────────┐
│ Renderer (React)                            │
│  Components → hooks → window.mms.*         │
└──────────────────┬──────────────────────────┘
                   │ contextBridge (secure)
┌──────────────────▼──────────────────────────┐
│ Preload                                       │
│  ipcRenderer.invoke(channel, ...args)        │
└──────────────────┬──────────────────────────┘
                   │ IPC
┌──────────────────▼──────────────────────────┐
│ Main Process (Node.js)                       │
│  ipcMain.handle → services → repositories   │
│  ↳ better-sqlite3 (synchronous)             │
└──────────────────────────────────────────────┘
```

## First-Run Setup (No Default Password)

There is **no default password**. On first launch the app detects the seeded
placeholder administrator and shows a one-time **Initial Setup** screen where
you create the real administrator account in place:

- **Username**: 3–32 characters — letters, numbers, dot, underscore or hyphen
- **Full name**: shown across the app and recorded in the audit log
- **Password**: at least 8 characters with uppercase, lowercase, digit and
  special character (enforced at creation and on every password change)

The placeholder administrator is replaced on the same user id, so the audit
trail stays intact. Subsequent launches show the normal login screen. As a
brute-force safeguard, 5 failed attempts lock the account for 15 minutes.

## Database

The app stores its SQLite database at:
- **Windows**: `%APPDATA%/Minz Mahallu Management System/mms.db`
- **macOS**: `~/Library/Application Support/Minz Mahallu Management System/mms.db`
- **Linux**: `~/.config/Minz Mahallu Management System/mms.db`

On first launch, the schema and seed data are loaded automatically from
`resources/sql/`. Subsequent launches apply any pending migrations from
`resources/sql/migrations/`.

## Migration from Qt Version

This branch (`react-electron-port`) was created from the original Qt/QML `master`
branch. The SQL schema, seed data, and migration files are identical, so the
React/Electron edition is fully compatible with databases created by the Qt version.

## Verification

Module integrity, report layout, welfare CRUD compatibility and demo seed coverage are continuously verified in CI.

## License

MIT

<!-- integrity-check -->
