# Harbor Deeds

A self-contained, original property game for 2–4 merchants. [Play on GitHub Pages](https://unpragmatic.github.io/harbour-deeds/) or open `docs/index.html` in a modern browser. Choose **New table** to mix local humans and bots. The current match lives in memory; reloading opens a fresh table.

## Build and publish

Requires stable Rust (1.80+), Python 3, and Node 20+ for tests.

```sh
rustup target add wasm32-unknown-unknown
npm ci
python3 build.py
node --test tests/engine.mjs
```

`dist/index.html` embeds the compiled Rust engine, board data, and UI. Local play works offline. The PeerJS client is loaded from the same origin only when connecting devices. Copy `dist/` contents to `docs/` and publish from `main` → `/docs` in GitHub Pages.

## Design and scope

`src/lib.rs` owns the seeded RNG, legal turns, ownership, cash transfers, bankruptcy and scoring. `web/rules.json` supplies the base board and economy; `web/outer-harbor.json` supplies the larger circuit's additions and salary override.

Each seat selects a controller implementing `(snapshot, abortSignal) => Promise<command>`. The host routes the decision to the turn owner, current auction bidder, or trade recipient. All commands go to the same WASM handler.

**Across devices:** Choose **New table → Host online**. Copy the six-character code; guests enter it under **New table → Join online**. The host chooses the board, bid clock and owner of each seat (host, connected device, or bot). A single device may operate several seats. Keep the host tab active. Leaving or losing a connected device during a match ends the table; rejoining, persistence and host migration are not supported.

## Interaction review

The phone shell keeps the decision dock visible while the board, portfolios or activity scroll independently. Desktop uses the same decisions alongside the workspace. Native buttons, selects, numeric inputs and dismissible dialogs support touch and keyboard use. The review counts deliberate control activations from the indicated starting screen, not typing, elapsed time or human-study observations.

| Interaction | Previous flow → revised flow |
|---|---|
| Launch and roll | A ready solo game remains the default. One press rolls; there is no welcome gate. |
| Start two-player pass-and-play | From play: New table, change two seat selectors, Start → New table, Pass & play. Custom seat, board and clock controls remain under Custom local table. |
| Host / join / assign | Host lobby entry: 3 presses → 2. Join opens directly on the code input. Copy replaces manual transcription; new devices still receive a seat automatically. |
| Inspect / rules / back | One space opens its deed; the header help button opens rules. Dismiss with Close or Escape. Phone sheets open above the current view. |
| Inspect standings / history | Scroll past the board → one view switch. Full history replaces the eight-entry window. The same turn action stays available in every view. |
| Buy / decline / bid | Buy and Start auction stay explicit, one press each. Minimum bid stays one press; a larger preset now also takes one, without opening a keyboard. Custom bids keep exact price control. Withdraw stays explicit. |
| Propose / respond | A blank four-field contract → an editable deed-for-cash draft. From the turn screen, the suggested deal takes two presses: Draft trade, Send proposal. Recipients still see both sides before Accept or Decline. |
| Wait / timeout / settle | No acknowledgement clicks. Show whose decision is pending; the host clock continues during guest dialogs. Expiring custom bids close rather than leaving stale inputs. |
| Results / rematch / leave | Local rematch reuses seats, board and clock in one press rather than reopening setup. An intentional network exit asks for confirmation because it ends everyone's match. |

Public PeerJS signaling establishes WebRTC connections; it does not run the game. Connectivity depends on the signaling service, browser and network. The code is a temporary invitation, not an account or authentication credential. Hosts validate device ownership and decision sequence before sending a command to Rust. Peers start from the same seed and configuration and replay the ordered, accepted commands. `python3 tests/multiplayer.py` exercises three browsers over real WebRTC using a local test signaling server.

## Decisions and transitions

| State | Decision | Next state |
|---|---|---|
| Before rolling | Roll, or draft one proposal with a solvent merchant | Landing or trade review |
| Trade review | Recipient accepts both legs or declines; the engine transfers assets together | Original seat resumes before rolling |
| Unowned deed | Buy at list price or start an auction | Settlement or auction |
| Auction | Current bidder raises by at least the increment or withdraws | Next bidder, sale to high bidder, or unsold |
| Settlement | No confirmation needed; rent, fees, movement and sales are logged | Next seat or final accounts |

Complete districts double rent. Cash also matters: winning a bid can leave too little to pay the next bill. An 18-round limit bounds play. Mortgages, buildings and jail are outside this edition.

## Gameplay and visual review

Means across 100 three-bot matches, seeds 1–100, using the shipped policy for each edition. Reproduce the current sample with `node tests/pace.mjs` after building.

| Per match | Original | Market edition |
|---|---:|---:|
| Player commands (excluding automatic transitions) | 119.39 | 83.11 |
| Market commands (buy/pass, bidding, withdrawing, proposing, responding) | 11.39 | 30.68 |
| Districts completed at game end | 0.16 | 2.79 |
| Auctions / accepted trades | 0 / 0 | 1.59 / 4.76 |

The original policy almost always bought and manually ended every turn. Removing the end click cut friction; narrower cash margins made bidding and reserves matter. The new bots seek mutually profitable set-building trades. All their proposals were accepted in this sample: the economic model encourages set completion, but does not model bluffing or human bargaining. Counts measure opportunities and commands, not human enjoyment or the strategic significance of every bid.

The browser review exercised opening, offer, auction, bidder handoff, settlement, trade draft, recipient review and final scoring. Mobile now puts the active decision before the board; image inspection caught a clipped bottom row, fixed with bounded grid tracks. [View the captured decision screens](review/state-review.png). `review/screens.py` regenerates the captures using Python Playwright, Pillow and Chrome after a build.
## Board size and bid clocks

**New table** offers Inner Harbor (20 spaces, four districts) or Outer Harbor (28 spaces, six districts). The expanded map keeps the same 18-round limit and pays $168 per lap instead of $120: the expected salary per space travelled is unchanged, but paydays are farther apart. The compact map remains the default.

The clock defaults to **five seconds per human bidding decision**. Hosts can choose 15 seconds, 30 seconds or untimed. Local-only games pause for dialogs and hidden tabs; a network table uses the host's deadline regardless of guest UI state. Expiry submits `withdraw`; winning, payment and ownership remain Rust decisions. Neither bots nor headless simulations consult a clock.

In 100 matched three-bot seeds under each map, mean turns barely changed (52.43 vs 52.70). Market commands rose from 30.68 to 54.85, auctions from 1.59 to 4.88, and bids from 6.39 to 18.17. Completed sets rose only from 2.79 to 2.94 despite two extra districts. Expansion adds competition and cash pressure, but many extra inputs are bids, not new kinds of decision. Reproduce with `node tests/pace.mjs` and `node tests/pace.mjs dist/index.html outer`.

**Depth priorities:** First, vary bot valuations: charge more to complete a rival's district and compare deal acceptance and winner concentration. The current bots accepted every bot-generated proposal on both boards. Second, prototype one optional upgrade on a completed district: spend a cash reserve now for higher future rent. Measure whether upgrades pay back at different stages and whether they amplify early leads. Avoid adding more spaces or mandatory prompts until human playtests measure auction time and perceived control.
