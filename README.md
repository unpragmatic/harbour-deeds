# Harbor Deeds

A self-contained, original property game for 2–4 merchants. [Play on GitHub Pages](https://unpragmatic.github.io/harbour-deeds/) or open `docs/index.html` in a modern browser. Local-only games live in memory. In-progress network tables can be recovered in the original browsers.

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

**Across devices:** Choose **New table → Host online**. Copy the six-character code; guests enter it under **New table → Join online**. The host chooses the board, bid clock and seat assignments. A single device may operate several seats.

**Recover a network match:** Reopen the site in the same browser profile. The original host chooses **Rehost table** to restore the same code and match; guests choose **Rejoin table** to reclaim their seats. Both actions are also accessible under **New table**. The match and auction clock pause until assigned devices reconnect. Confirming **Leave table** ends the match; a reload does not. Recovery stores one in-progress table per browser and site, not a cloud backup. Clearing site data or losing the original host profile prevents rehosting; another device cannot take over as host.

## Interaction review

Maintain `web/interactions.json` with changes to controls, cues and board identifiers. The build rejects undocumented Rust commands. Local, host and guest live moves use the command-to-cue mapping; replay, simulation and ordinary turn advancement are silent. `review/components.py` publishes the same inventory in the illustrated checklist. For new UI-only flows, update the surfaces list and the relevant browser walkthrough in the same change.

The [click audit](https://unpragmatic.github.io/harbour-deeds/components.html#clicks) and [contrast measurements](https://unpragmatic.github.io/harbour-deeds/components.html#contrast) are generated from `review/clicks.json` and the browser walkthroughs. Add actions with a starting state and mouse cost; compose scenario paths from their IDs and set a ceiling. Link qualitative criteria to both the interaction IDs and measured scenarios: click count alone cannot detect an invisible choice. After building, run `python review/desktop.py`, `python review/improvements.py`, then `python review/components.py`. The latter rejects criteria with missing measured paths. Rows without a measured path are labeled as control traces.

**Manage deeds:** Before rolling, select a diamond-marked deed on the board, or choose **Manage deeds**. **Improve** and **Sell** share the same selection when it is eligible for both. In each mode the board shows cost or payout on the actual candidates and the desk previews the selected outcome. Whole-district projects can be selected from any member. A tile click never buys, builds or sells: use the priced confirmation to commit, or Cancel / Esc to leave. Public works uses the same board selection for a one-use refit.

The chart shows the last accepted action. The helm on the right asks for the **next** decision; costs, commands and the deed inspector share one column. At laptop size Grand Harbor is a 13 × 9 perimeter, not a row-major list. Smaller screens keep the folded route and the reachable bottom dock. Cash stays visible across board instruments and game sheets. **R** rolls, **T** drafts a trade, **S** quotes a bank sale and **I** previews a build; shortcuts do not commit spending and are suspended in sheets. **Display** sets the local pace; normal play gives the dice and ship time to settle, Fast uses the shorter timings, and reduced motion keeps the same results. None changes the Rust simulation or the host’s bid deadline.

[Open the illustrated component overview](https://unpragmatic.github.io/harbour-deeds/components.html) for the controls, decision screens and recovery flow in one place. Expand a capture to inspect it. Each card explains a change or an improvement opportunity.

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

Owning every deed in a district unlocks pre-roll improvements. Choose even building (default), unrestricted per-deed building, or whole-district purchases in custom local or host settings. [Development economics](https://unpragmatic.github.io/harbour-deeds/development.html) gives the rules, proof of diminishing marginal return, and matched-seed evaluation. After building, `node tests/development.mjs` reproduces the per-tier and game totals; `node tests/build-or-hold.mjs` compares buying and holding at the same decision states.

| State | Decision | Next state |
|---|---|---|
| Before rolling | Roll, or draft one proposal with a solvent merchant | Landing or trade review |
| Before rolling, eligible deed | Review the bank quote and sell, or keep it | Same seat still has its roll |
| Public works, eligible deed | Pay for a single-use refit or skip it | Settlement; next rival rent can collect the bonus |
| Trade review | Recipient accepts both legs or declines; the engine transfers assets together | Original seat resumes before rolling |
| Unowned deed | Buy at list price or start an auction | Settlement or auction |
| Auction | Current bidder raises by at least the increment or withdraws | Next bidder, sale to high bidder, or unsold |
| Settlement | No confirmation needed; rent, fees, movement and sales are logged | Next seat or final accounts |

Complete districts double base rent and unlock improvements. Cash also matters: winning a bid can leave too little to pay the next bill. The boards have fixed round limits.

`bank_sale.rate_pct` and `bank_sale.basis` are designer rules, not local display settings. Shipped sales pay **50% of printed list**: paying $60 at auction for a $200 deed and selling it back for $100 is intentional. The alternative basis tracks the original price paid to the bank across player trades. Permanent development locks a district against both sale and trade. Dock Works and Rigging Works instead offer a one-use bonus on the next rival rent: no complete district required, no permanent rent increase, no recovery if no rival visits. See the [economics report](https://unpragmatic.github.io/harbour-deeds/development.html) for the assumptions behind the permanent curve.

Network saves now carry a rules edition. Journals that predate editions replay against `web/edition-launch.json`, frozen from the deployed build, rather than silently repricing past purchases or changing an old landing. All devices at a table must load the same compatible release.

## Gameplay and visual review

Historical means across 100 three-bot matches, seeds 1–100, using the policy for each edition. These figures predate bank sales and public works; `node tests/pace.mjs` runs the same survey with the current policy.

| Per match | Original | Market edition |
|---|---:|---:|
| Player commands (excluding automatic transitions) | 119.39 | 83.11 |
| Market commands (buy/pass, bidding, withdrawing, proposing, responding) | 11.39 | 30.68 |
| Districts completed at game end | 0.16 | 2.79 |
| Auctions / accepted trades | 0 / 0 | 1.59 / 4.76 |

The original policy almost always bought and manually ended every turn. Removing the end click cut friction; narrower cash margins made bidding and reserves matter. The new bots seek mutually profitable set-building trades. All their proposals were accepted in this sample: the economic model encourages set completion, but does not model bluffing or human bargaining. Counts measure opportunities and commands, not human enjoyment or the strategic significance of every bid.

The browser review exercised opening, offer, auction, bidder handoff, settlement, trade draft, recipient review and final scoring. Mobile now puts the active decision before the board; image inspection caught a clipped bottom row, fixed with bounded grid tracks. [View the captured decision screens](review/state-review.png). `review/screens.py` regenerates the captures using Python Playwright, Pillow and Chrome after a build.
## Board size and bid clocks

**Grand Harbor** is the default: 40 spaces, eight three-deed districts and 26 rounds. With two six-sided dice the mean move is seven spaces, so a player travels about 4.55 circuits in 26 rolls. The $240 salary keeps salary per space at $6, equal to the shorter boards. Inner Harbor (20 spaces) and Outer Harbor (28) remain available with their original 18-round games.

Designer controls are in `web/grand-harbor.json`, not in a player-facing rules editor. Set `dice.count` and `dice.sides`, circuit order, deed economics, guild payouts, or the `cards` list before building. Card kinds are `cash` (flat signed payment), `deeds` (per owned deed), `levels` (per installed level), and `cover` (insurance limit). Duplicate an entry for more copies. Rust shuffles the deck with the match RNG, draws without replacement and reshuffles after exhaustion. Identical seeds, rules and commands reproduce draws and rolls. Classic boards keep their original notice draws for old journals.

Guilds offer an immediate grant or a policy covering up to a stated amount of the next rival rent. Cover never stacks, the bank pays the insured portion to the landlord, and the policy expires on use. Exchanges auction the next vacant deed clockwise without moving the visitor; they close when everything is owned. The activity feed records card and space outcomes.

The clock defaults to **five seconds per human bidding decision**. Hosts can choose 15 seconds, 30 seconds or untimed. Local-only games pause for dialogs and hidden tabs; a network table uses the host's deadline regardless of guest UI state. Expiry submits `withdraw`; winning, payment and ownership remain Rust decisions. Neither bots nor headless simulations consult a clock.

In the original Inner-to-Outer expansion survey, 100 matched three-bot seeds averaged 52.43 vs 52.70 turns. Market commands rose from 30.68 to 54.85, auctions from 1.59 to 4.88, and bids from 6.39 to 18.17. Completed sets rose only from 2.79 to 2.94 despite two extra districts. Many extra inputs were bids, not new kinds of decision.

**Current balance finding:** In 200 three-seat Grand Harbor seeds, the first affordable permanent level was bought in one branch and deferred in the other. The builder finished richer in 46, poorer in 75 and tied in 79. This is a fixed bot policy at one decision per seed, not proof that holding is generally best. The next useful human playtest is whether buyers can explain when they'd rather keep a cash reserve, sell a deed, or risk a one-use refit.
