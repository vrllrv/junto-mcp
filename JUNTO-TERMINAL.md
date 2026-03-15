# Junto Terminal — Fork Plan

> A branded terminal for payments. Scan, pay, get paid — from where you already work.

---

## Vision

Developers already live in the terminal. But terminals are ugly, unconfigured, and intimidating for most people. Junto Terminal is a **branded Hyper fork** that ships with the Junto CLI pre-installed, a Pix-friendly theme, and sandbox mode — making payments from the command line accessible to anyone, not just developers.

**The pitch:** "Pay from your project folder."

```
cd ~/projects/client-acme
junto cobrar 5000.00 "Sprint 3 — entrega final"
# QR code appears → client scans → money arrives
```

---

## Why Fork Hyper

| Criteria | Hyper | Windows Terminal | Warp | Alacritty |
|---|---|---|---|---|
| License | MIT | MIT | Proprietary | Apache 2.0 |
| Stack | Electron + React + TS | C++ | Rust | Rust |
| Theming | CSS (trivial) | JSON | Limited | YAML |
| Plugin system | Yes (npm) | No | No | No |
| Fork difficulty | Low | High | N/A | Medium |
| Windows Store | Yes (Electron) | N/A | N/A | Manual |
| Customizable UI | Full (it's React) | Limited | No | No |
| Stars | ~44.7k | ~96k | ~22k | ~57k |

**Hyper wins because:** it's React/TS (we already know this), fully CSS-themeable, has an npm plugin system we can leverage, and MIT license lets us fork, rebrand, and distribute freely.

---

## Project Structure

```
junto-mcp/                    ← existing (protocol + CLI)
junto-terminal/               ← new repo (Hyper fork)
  ├── app/                    ← Electron main process
  │   ├── index.ts            ← main entry (forked from Hyper)
  │   ├── config.ts           ← default config with Junto theme
  │   └── auto-update.ts      ← update channel for Junto Terminal
  ├── lib/                    ← renderer process (React)
  │   ├── components/         ← React components
  │   │   ├── header.tsx      ← title bar (branded)
  │   │   ├── tab.tsx         ← tab component
  │   │   ├── term.tsx        ← xterm.js wrapper
  │   │   ├── junto-panel.tsx ← NEW: payment sidebar panel
  │   │   └── onboarding.tsx  ← NEW: first-launch setup
  │   ├── store/              ← Redux state
  │   └── utils/
  ├── junto/                  ← NEW: Junto-specific features
  │   ├── plugin.ts           ← built-in Junto plugin
  │   ├── sandbox.ts          ← sandbox mode (test API)
  │   ├── history.ts          ← transaction history view
  │   ├── notifications.ts   ← payment received notifications
  │   └── theme.ts            ← Junto violet theme
  ├── assets/
  │   ├── icon.png            ← Junto Terminal icon
  │   ├── logo.svg            ← splash / about screen
  │   └── sounds/             ← optional: payment received sound
  ├── static/                 ← HTML entry points
  ├── package.json
  ├── electron-builder.yml    ← build config (Windows Store, Mac, Linux)
  └── README.md
```

---

## Phase 1: Fork + Rebrand (Week 1)

### 1.1 Fork Hyper

```bash
git clone https://github.com/vercel/hyper.git junto-terminal
cd junto-terminal
git remote rename origin upstream
git remote add origin https://github.com/vrllrv/junto-terminal.git
```

### 1.2 Rebrand

- **App name:** Junto Terminal (or "Junto Prompt")
- **package.json:** name, description, author, repository
- **Window title:** "Junto Terminal"
- **App icon:** Junto logo (violet on dark)
- **About screen:** Junto branding + version
- **Menu bar:** remove Hyper-specific links, add Junto links

### 1.3 Default Theme

Apply the Junto brand palette as the default Hyper theme:

```javascript
// .hyper.js default config
module.exports = {
  config: {
    fontSize: 14,
    fontFamily: '"JetBrains Mono", "Cascadia Code", Menlo, monospace',

    // Junto violet theme
    cursorColor: '#7C3AED',
    foregroundColor: '#E5E7EB',
    backgroundColor: '#0F0F14',
    selectionColor: 'rgba(124, 58, 237, 0.3)',

    borderColor: '#1F1F2E',

    colors: {
      black:   '#1F1F2E',
      red:     '#EF4444',
      green:   '#10B981',
      yellow:  '#F59E0B',
      blue:    '#3B82F6',
      magenta: '#7C3AED',
      cyan:    '#06B6D4',
      white:   '#E5E7EB',

      lightBlack:   '#6B7280',
      lightRed:     '#F87171',
      lightGreen:   '#34D399',
      lightYellow:  '#FBBF24',
      lightBlue:    '#60A5FA',
      lightMagenta: '#A78BFA',
      lightCyan:    '#22D3EE',
      lightWhite:   '#F9FAFB',
    },

    css: `
      /* Junto Terminal custom styles */
      .header_header { background: #0F0F14; }
      .tab_active { border-bottom: 2px solid #7C3AED; }
    `,
  },
};
```

### 1.4 Ship pre-configured shell

On first launch:
- Detect OS shell (PowerShell on Windows, zsh/bash on Mac/Linux)
- Auto-run `npm list -g junto-mcp` to check if Junto CLI is installed
- If not installed, show onboarding prompt

---

## Phase 2: Junto Integration (Week 2-3)

### 2.1 First-Launch Onboarding

When Junto Terminal opens for the first time:

```
╭──────────────────────────────────────────────╮
│                                              │
│       _             _                        │
│      | |_   _ _ __ | |_ ___                 │
│   _  | | | | | '_ \| __/ _ \                │
│  | |_| | |_| | | | | || (_) |               │
│   \___/ \__,_|_| |_|\__\___/                │
│                                              │
│  Welcome to Junto Terminal!                  │
│                                              │
│  Let's set up your payment tools.            │
│                                              │
│  [Install Junto CLI]  [Skip]                 │
│                                              │
╰──────────────────────────────────────────────╯
```

Steps:
1. Install `junto-mcp` globally (`npm install -g junto-mcp`)
2. Run `junto setup` to configure API key
3. Show a test charge to verify everything works

### 2.2 Sandbox Mode Toggle

Add a toggle in the toolbar or menu:

```
[🟢 Production]  ←→  [🟡 Sandbox]
```

- **Production:** uses real API keys, real money
- **Sandbox:** uses test API keys, fake transactions
- Visually distinct: sandbox mode gets a yellow border / banner
- Stored in `~/.junto/config.json` as `"mode": "sandbox" | "production"`

### 2.3 Payment Sidebar Panel (junto-panel.tsx)

A collapsible sidebar (like VS Code's sidebar) showing:

```
┌─ Junto ──────────────────┐
│                          │
│  Saldo: R$ 1,250.00     │
│  ────────────────────    │
│                          │
│  Hoje                    │
│  ✓ R$ 25.00 → maria@... │
│  ✓ R$ 10.00 ← cafe      │
│  ● R$ 150.00 pendente   │
│                          │
│  ────────────────────    │
│  Limites: 25% usado     │
│  ███░░░░░░░░░ R$125/500 │
│                          │
│  [Cobrar]  [Pagar]      │
│                          │
└──────────────────────────┘
```

- Real-time balance
- Transaction history (from audit log)
- Spending limit progress bar
- Quick action buttons that run CLI commands

### 2.4 Payment Notifications

When a charge gets paid (via polling or future webhook):

```
╭──────────────────────────────────╮
│  ✓ Pagamento recebido!          │
│  R$ 25.00 via Pix               │
│  de: maria@email.com            │
╰──────────────────────────────────╯
```

- Desktop notification (Electron Notification API)
- Optional sound effect
- Show in the sidebar panel

---

## Phase 3: Distribution (Week 3-4)

### 3.1 Electron Builder Config

```yaml
# electron-builder.yml
appId: com.junto.terminal
productName: Junto Terminal
copyright: Copyright © 2026 vrllrv

win:
  target:
    - target: appx      # Windows Store
      arch: [x64, arm64]
    - target: nsis       # standalone installer
      arch: [x64]
  icon: assets/icon.ico

mac:
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: mas        # Mac App Store
      arch: [x64, arm64]
  icon: assets/icon.icns
  category: public.app-category.developer-tools

linux:
  target:
    - target: AppImage
    - target: snap       # Snap Store
    - target: deb
  icon: assets/icon.png
  category: Development

publish:
  provider: github
  owner: vrllrv
  repo: junto-terminal
```

### 3.2 Distribution Channels

| Platform | Format | Store |
|---|---|---|
| Windows | .appx | Microsoft Store |
| Windows | .exe | GitHub Releases |
| macOS | .dmg | GitHub Releases |
| macOS | .mas | Mac App Store (future) |
| Linux | .AppImage | GitHub Releases |
| Linux | .snap | Snap Store |

### 3.3 Auto-Update

- Electron auto-updater via GitHub Releases
- Check for updates on launch (silent)
- Prompt when update is available

---

## Phase 4: Advanced Features (Future)

### 4.1 Multi-tab Payment Contexts

Each tab can have its own payment context tied to the working directory:

```
[~/projects/client-a] [~/projects/client-b] [+]
```

- Different clients, different invoicing contexts
- Transaction history scoped to project folder

### 4.2 QR Code Overlay

When `junto cobrar` generates a QR code, instead of ASCII art, render a proper QR code overlay in the terminal using Electron's overlay capabilities — crisp, scannable even on small screens.

### 4.3 Junto Connect

Pair two Junto Terminals for instant transfers:

```
junto connect <peer-id>
# Establishes encrypted channel
# Send/receive money between terminals
```

### 4.4 Plugin Marketplace

Since Hyper already has a plugin system, extend it:

- `junto-plugin-stripe` — Stripe integration
- `junto-plugin-wise` — international transfers
- `junto-plugin-invoice` — PDF invoice generation
- `junto-plugin-accounting` — export to accounting software

### 4.5 Junto Terminal Pro

Freemium model:
- **Free:** full CLI, sandbox mode, basic theme
- **Pro:** payment sidebar, notifications, multi-project contexts, custom themes, priority support

---

## Technical Decisions

### Keep Hyper's Plugin System

Don't remove it. Instead:
- Ship Junto features as a **built-in plugin** (always loaded)
- Users can still install other Hyper plugins
- Junto-specific plugins extend the payment features

### Upstream Sync

- Periodically merge upstream Hyper changes
- Keep Junto changes in separate files/folders where possible
- Minimize modifications to Hyper's core files

### Config File

Junto Terminal uses the same `~/.junto/config.json` as the CLI. No separate config. The terminal is just a nicer window around the same tools.

---

## Naming

Options:

| Name | Pros | Cons |
|---|---|---|
| **Junto Terminal** | Clear, professional | Generic "terminal" |
| **Junto Prompt** | Friendly, approachable | Might confuse with AI prompts |
| **Junto Shell** | Technical, accurate | Too developer-ish |
| **Junto Pay Terminal** | Very clear purpose | Long |

Recommendation: **Junto Terminal** for the app, **junto** for the CLI command (already done).

---

## MVP Scope

For the first release, keep it simple:

1. Forked Hyper with Junto branding
2. Violet dark theme (default)
3. First-launch onboarding (install CLI + setup)
4. Sandbox/Production toggle
5. Windows installer (.exe) + GitHub Release
6. README with screenshots

Everything else (sidebar, notifications, store publishing) comes in v2.

---

## Repository

```
github.com/vrllrv/junto-terminal
```

Separate repo from `junto-mcp`. The terminal is a distribution vehicle for the protocol — it doesn't contain payment logic itself.

---

## Timeline

| Phase | Scope | Estimate |
|---|---|---|
| Phase 1 | Fork + rebrand + theme | 1 week |
| Phase 2 | Onboarding + sandbox toggle | 2 weeks |
| Phase 3 | Build + distribute (Windows) | 1 week |
| Phase 4 | Sidebar + notifications | Future |

---

## Dependencies

- Hyper (upstream fork)
- junto-mcp (npm, pre-installed)
- Electron Builder (packaging)
- GitHub Actions (CI/CD for builds)
