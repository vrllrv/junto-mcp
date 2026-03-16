# Junto — Demo Recording Script

> Follow this step by step while recording your screen.
> Each step is a command you type in the terminal.
> Pause 2-3 seconds between steps so viewers can read.

---

## Setup Before Recording

- Open your terminal (Hyper, Windows Terminal, or iTerm2)
- Make sure `junto` is installed: `npm install -g junto-mcp`
- Make sure your API key is configured: `junto setup` (if not already done)
- Resize terminal to a clean size (around 100x30 characters)
- Use a dark background for best contrast with the violet theme
- Clear the screen: `clear`

---

## Scene 1: Introduction (15 seconds)

```bash
junto ajuda
```

> Shows the Junto ASCII logo, all commands in Portuguese.
> Let it sit for 3 seconds so viewers can read.

---

## Scene 2: Providers (10 seconds)

```bash
junto provedores
```

> Shows Woovi is live with Pix, instant settlement.

---

## Scene 3: Spending Limits (10 seconds)

```bash
junto limites
```

> Shows the progress bar, daily limit, per-tx max, confirm threshold.
> Point: "Agents can't go rogue — hard limits built in."

---

## Scene 4: Create a Pix Charge with QR Code (20 seconds)

```bash
junto cobrar 1.00 "Cafe demo"
```

> This is the hero moment. Real API call. QR code appears in the terminal.
> Payment link, Pix copy-paste code — all live.
> Let it sit for 5 seconds so viewers can see the QR code.

---

## Scene 5: Check Status (10 seconds)

Copy the ID from the previous step and run:

```bash
junto status <paste-id-here>
```

> Shows ACTIVE status in yellow. Real-time query to Woovi.

---

## Scene 6: Check Balance (10 seconds)

```bash
junto saldo
```

> Shows real account balance from Woovi.

---

## Scene 7: Guardrail — Human Confirmation (15 seconds)

```bash
junto pagar 150.00 maria@email.com
```

> Amount is above R$50 threshold — CLI asks for confirmation.
> Type `n` to cancel.
> Point: "Above R$50, the human always decides."

---

## Scene 8: Guardrail — Hard Block (10 seconds)

```bash
junto pagar 500.00 rogue@hacker.com
```

> Blocked! Exceeds per-transaction limit of R$200.
> Point: "No override. The agent cannot send this."

---

## Scene 9: English Mode (10 seconds)

```bash
junto help
```

> Same tool, English output. Auto-detects from command.

---

## Scene 10: MCP Mode (10 seconds)

```bash
echo "AI agents connect via MCP protocol:"
junto --version
```

> Mention: "Same server runs as MCP for Claude, Cursor, or any AI client."
> Don't actually run `junto --mcp` (it blocks waiting for stdin).

---

## Closing (5 seconds)

```bash
echo ""
echo "npm install -g junto-mcp"
echo "github.com/vrllrv/junto-mcp"
```

> Or just say it while the terminal is visible.

---

## Total Time: ~2 minutes

## Tips

- **Don't rush.** Let each output breathe for 2-3 seconds.
- **No narration needed** if you add captions/subtitles later.
- **If narrating live:** keep it short. "Create a charge..." → command → "QR code, scannable, live Pix." → next.
- **The QR code is the hero shot.** Let it fill the screen.
- **If a command fails:** that's fine, it shows real error handling. Keep recording.

## Optional: Pay the Charge Live

If you want the ultimate demo, have your phone ready:
1. Run `junto cobrar 5.00 "Live demo"`
2. Scan the QR code with your bank app
3. Pay the R$5.00
4. Run `junto status <id>` — shows COMPLETED in green

This proves real money moved through the protocol. Killer demo.

## Shortcut: Automated Demo

If you prefer the automated typewriter-style demo:

```bash
npx tsx demo/demo.ts
```

This runs all steps automatically with narration and real API calls.
