# Harbor Deeds

A self-contained, original property game for 2–4 merchants. [Play on GitHub Pages](https://unpragmatic.github.io/harbour-deeds/) or open `docs/index.html` in a modern browser. Choose **New table** to mix local humans and bots. The current match lives in memory; reloading opens a fresh table.

## Build and publish

Requires stable Rust (1.80+), Python 3, and Node 20+ for tests.

```sh
rustup target add wasm32-unknown-unknown
python3 build.py
node --test tests/engine.mjs
```

`dist/index.html` embeds the compiled Rust engine, board data, and UI. No server, npm dependencies, CDN, or runtime downloads are needed. Copy the verified build to `docs/index.html` and publish from `main` → `/docs` in GitHub Pages.

## Design and scope

`src/lib.rs` owns the seeded RNG, legal turns, ownership, cash transfers, bankruptcy and scoring. `web/rules.json` supplies the board, districts, prices, rents, fees, notice payouts, salary, starting cash and round limit. The current UI lays out a 20-space circuit.

Each seat selects a controller implementing `(snapshot, abortSignal) => Promise<command>`. The host routes the decision to the turn owner, current auction bidder, or trade recipient as appropriate. All commands go to the same WASM handler. Local and bot seats can be freely mixed. Transport, pairing, and reconnects are not implemented.

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
