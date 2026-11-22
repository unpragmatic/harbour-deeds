"""Generate the one-page illustrated review from the local and multiplayer UI walkthroughs."""
from base64 import b64encode
from html import escape
import json
import re
import sys
from io import BytesIO
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
report=root.parent/'docs/components.html'
# The repo ships the illustrated report, not every historical PNG. In a partial
# walkthrough, keep those previously published captures byte-for-byte.
published=dict(re.findall(r'<article><h3>([^<]+)</h3><details><summary>Inspect capture<img src="data:image/webp;base64,([^"]+)"',report.read_text())) if sys.argv[1:]==['--reuse-published-captures'] else {}
sections = {
    'Desktop playtest review': [
        ('decision-flow-before','Before: one offer, three reading locations','The previous layout repeated the space name in the chart, inspector and footer. Buying meant leaving the economics at the upper right for a button at the opposite end of the screen. The folded chart was hard to follow as a circuit.'),
        ('desktop-before','Before: laptop table','The treasury was a child of the board. Opening Activity hid both the board and every balance. The small green-gray labels also gave little separation between status and controls.'),
        ('desktop-offer','After: chart → decision → details','At 1366 × 768 the ship travels a continuous perimeter. A single right rail asks “Buy or auction?”, puts both commitments immediately below their amounts, and keeps the selected deed’s ladder underneath. The treasury stays fixed.'),
        ('desktop-log','After: read the log','Activity changes only the right instrument. The board and current commands stay in place; reading the treasury costs zero clicks.'),
        ('desktop-auction','After: timed auction','Bidder, next commitment, time remaining and all cash balances remain visible. Inspecting the lot is not a bid.'),
    ],
    'Read the table in play': [
        ('center-handoff','Who acts now, who just paid?','The upper left gives Seat 1 the turn. The upper right keeps Seat 2’s roll of seven. Below the landing, the payment names both seats and shows why the company collected $70.'),
        ('center-handoff-phone','The same handoff on a phone','Around the board keeps the same reading order inside the circuit. The last transfer sits directly below the actor and dice so it does not require scrolling to the far end.'),
        ('fleet-stations','Whose ship, and whose deed?','Ship 2 is visiting Silk Arcade. The S1 mark says the deed belongs to Seat 1, whose ship is at Port Office. Select a fleet berth to locate that ship without changing the chosen deed.'),
        ('dispatch-desktop','Read it now or later','Fogbound cargo charged Seat 1 $55. Passing Port Office earned $240. The letter separates both amounts while Seat 2 plays, then leaves the chart on its own. Activity keeps the exact receipt.'),
        ('dispatch-phone','Read through a handoff','Muted and reduced motion: the card still names its recipient and displays $65 of cover, with the next player’s roll available underneath.'),
        ('display-settings','Presentation, per device','Standard separates the cast, the journey and the landing. Fast shortens presentation; reduced motion uses the same final result. This is not a host rule and does not change the five-second clock.'),
        ('motion-roll','Roll and travel','The dice settle to the Rust result and the numbered ship moves clockwise. The arrival and price remain readable after motion stops.'),
        ('motion-sale','Hammer falls','The lot is stamped and the ledger debits the winner, not the player who withdrew. The next decision is available separately.'),
        ('motion-phone','Reduced-motion phone','Same seeded arrival, with stationary dice, a pinned result and a larger three-column route. Muting does not remove any information.'),
    ],
    'Set up a table': [
        ('modes', 'Mode picker', 'Keep the four play modes visible. Common local games start immediately; customization is secondary.'),
        ('settings', 'Local settings', 'Board and clock apply to the whole table; seat selectors choose the controllers. A future improvement is a short roster summary before Start.'),
        ('join', 'Join by code', 'One input accepts a typed or pasted six-character code. Explicit submission lets players correct it before connecting.'),
        ('host-lobby', 'Host lobby', 'Keep the invitation code beside Copy. Connected devices receive seats automatically, with individual overrides for shared devices.'),
        ('guest-wait', 'Guest waiting room', 'Identify the table and joining device. Showing the guest their provisional seat assignments before launch would reduce uncertainty.'),
        ('recovery', 'Interrupted table', 'Distinguish a paused network table from a completed match. A returning device needs a recovery action, not a fresh local game.'),
    ],
    'Navigate and inspect': [
        ('district-pairs','Districts without their headers','For each Grand Harbor district: a full deed on the left, a different member on the right with color and the top third removed. These are enlarged crops of the actual board, not drawings of the intended tile.'),
        ('ownership-changes','Split → complete → sold','The same three Shipyards deeds, top to bottom. Before the swap Seat 1 owns two and Seat 3 one. After acceptance, all three marks read S1 SET. Selling Spar Yard removes its mark and the two remaining deeds return to S1 2/3.'),
        ('district-sets','Two owners, two complete sets','Shipyards is marked S1 SET; Exchange is S3 SET. Grain Quay belongs to Seat 3 even with Ship 1 visiting. The inspector groups district deeds by their current holder.'),
        ('district-grayscale','Follow the printed faces','All 27 Grand Harbor deeds carry their engraving across the board space. Bottle Post interrupts the brickwork of Old Town with a dark envelope face: a draw, not a deed.'),
        ('district-phone','Full names on the folded route','Three Old Town deeds share the same brickwork and full district name. The deed title sits directly on the print; a small plain ticket keeps the price distinct. No legend lookup or tap is required.'),
        ('crowded-space', 'Four visitors on an improved deed', 'Density fixture: one ownership mark above the name, four numbered ships below the rent. The inspector keeps the development ladder.'),
        ('grand-harbor', 'Grand Harbor circuit', 'The 40-space circuit distinguishes guilds, dispatches, exchanges, fees and deed districts. Inspect a space to read its effect.'),
        ('grand-chart', 'Pocket chart', 'On small devices the larger circuit becomes a scrollable route in movement order. The desktop perimeter is not shrunk to fit a phone.'),
        ('workbench', 'Purchase decision on desktop', 'The landed deed opens beside the board. See every tier’s construction cost, total rent and incremental payoff before buying or opening an auction.'),
        ('table', 'Board, turns and balances', 'Keep movement and cash visible together on desktop. The decision dock stays available when switching views on a phone.'),
        ('deed', 'Deed inspection', 'The owner or market status now comes first; price, base rent and full-district rent are aligned for comparison.'),
        ('players', 'Player portfolios', 'Show cash and district counts together. Choose a named holding to inspect it directly.'),
        ('activity', 'Activity feed', 'Keep history newest-first and available without dismissing the turn. Round dividers would make long matches easier to scan.'),
        ('help', 'Rulebook', 'Keep rules one tap away without leaving the table. The decision dock carries the immediate action rather than requiring a rulebook lookup.'),
    ],
    'Make a market decision': [
        ('rival-stakes','The opponent’s reason to bid','Seat 3 already owns Fish Hall and Tea Wharf. Buying Grain Quay blocks their set; putting it up for auction gives them a shot at $116 rent. The offer tells you before you choose.'),
        ('offer', 'Deed offer', 'Show the cash left after purchase alongside rent. Bid at auction remains a distinct alternative to buying at list price.'),
        ('phone-auction', 'Timed bid', 'A shrinking bar and numeric countdown show the remaining window; the last two seconds change color. Keep bid presets and withdrawal reachable without a keyboard.'),
        ('custom-bid', 'Custom bid', 'Show the legal range before numeric entry. A custom bid never commits until submitted; online, the host clock still applies.'),
        ('bid', 'Bidder handoff', 'Keep the leader and acting seat separate. The amount on each bid button is the actual commitment, not an increment.'),
        ('draft', 'Two districts, one draft', 'Grain Quay for Spar Yard completes Exchange and Shipyards. The suggested swap balances the printed values with $40. Either player’s stake is visible before a proposal is sent. Select another actual tile to change the deal.'),
        ('trade', 'The same deal, from the other chair', 'The proposer changed the premium to $30. GIVE and GET flip to the recipient’s perspective; ownership and the set counts stay unchanged until acceptance.'),
        ('trade-phone', 'Review on the folded chart', 'The same proposed assets are marked on the phone route. Cash and district effects live with the decision; the original owner keeps the deed until acceptance.'),
    ],
    'Settle the game': [
        ('debt-sale','Sell a deed or declare bankruptcy','The debtor owes $40. Selling Copper Yard nets $70: the creditor gets $40 and the debtor keeps $30. Declaring bankruptcy instead requires explicit confirmation.'),
        ('settled', 'Settlement', 'Show the outcome, then advance automatically. The activity feed preserves results that go by too quickly.'),
        ('final', 'Final accounts', 'Show the winner and each seat’s net worth. Local rematch reuses settings instead of reopening setup.'),
    ],
    'Develop a district': [
        ('board-sale','Sell a different deed','Each saleable deed shows the bank’s payout on the actual tile. Selecting Silk Arcade quotes its cash and forfeited rent; the board also shows the fall in rent on the rest of the set.'),
        ('works-quote','One-use refit','The same board picker previews a refit on Dry Dock while the ship stays at Dock Works. No rival visit means no payoff.'),
        ('build-even', 'Build or hold', 'Diamond marks give every available construction price; the check identifies the selected deed. Compare its rent before and after without leaving the map. Cancel spends nothing.'),
        ('build-district', 'Whole-district quote', 'Selecting any sibling previews the same project. Dashed outlines mark the other deeds that will improve; the map shows each one’s rent before and after, for one combined construction price.'),
        ('board-phone','Board targeting on a phone','The folded board scrolls independently above the quote. Tap a deed or step between candidates; cash, the actual outcome, and the confirmation stay in reach.'),
        ('built-deed', 'After construction', 'The deed shows its current rent, level cap and why its next level is blocked. District lock and investment are also visible in the portfolio.'),
    ],
}
out = ['''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Harbor Deeds · Component review</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f4ed;color:#213e34;font:16px/1.5 system-ui,sans-serif}
main{max-width:1180px;margin:auto;padding:20px}a{color:#215849}h1{font:2.5rem Georgia,serif;margin:.5em 0 0}
nav{display:flex;flex-wrap:wrap;gap:12px}section{margin:28px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:16px}
article{background:white;border:1px solid #cdd4c7;border-radius:12px;overflow:hidden;padding:15px}h3{margin:0}p{margin:.5em 0 1em}
summary{cursor:zoom-in;color:#215849}summary img{display:block;width:100%;height:185px;object-fit:contain;object-position:center;background:#eff2e8;margin:8px 0}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font:15px/1.35 system-ui;color:#172634;background:#fff8e9}th,td{text-align:left;vertical-align:top;padding:7px 8px;border-bottom:1px solid #aeb8bf}thead{background:#152638;color:white}caption{text-align:left;font-size:18px;font-weight:700;padding:10px 0}code{font-size:.85em}#clicks details{margin:10px 0}#clicks summary{font-weight:700}
.grid article:has(details[open]){grid-column:1/-1}details[open] summary{cursor:zoom-out}details[open] img{height:auto;width:auto;max-width:100%;margin-inline:auto}summary:focus-visible,a:focus-visible{outline:3px solid #ad6d1b}small{color:#496354}</style>
<main><a href="./">← Play Harbor Deeds</a><h1>Component overview</h1><p>A visual walkthrough of the decisions, handoffs and recovery screens. Select any capture to expand it.</p><nav>''']
out.append('<a href="#playtest">Eight-round playtest</a> <a href="#clicks">Click inventories</a> <a href="#contrast">Contrast measurements</a> <a href="#motion">Recorded turn</a>')
for i, section in enumerate(sections):
    out.append(f'<a href="#group{i}">{escape(section)}</a>')
out.append('</nav>')
out.append('''<section id="playtest"><h2>Playing for a district, not just taking turns</h2>
<p>Firsthand design playtest of the previous release: Grand Harbor, seed 1, eight rounds instead of the usual 26, untimed bidding. I played Seat 1 through the browser against the shipped bots. This was one deliberately short game, not a balance sample.</p>
<p>I turned down $204 for Dry Dock and paid $185 for Slipway. That left me one deed short of Shipyards. Later, I spent $230 on Grain Quay to block Seat 3’s Exchange set. The very next auction was for Spar Yard, the deed I wanted. With $125 left I couldn’t raise the $150 bid. Seat 3 won it for $200.</p>
<p><b>The best decision wasn’t a dice roll.</b> I traded Grain Quay for Spar Yard and $30. We both completed a district. I risked $30 improving Slipway; nobody landed there. Seat 2 landed on my trading partner’s Tea Wharf instead and paid $106. In net worth Seat 2 won with $1,157, ahead of Seat 3 at $1,023 and me at $880.</p>
<p><b>What felt flat:</b> the table showed Grain Quay’s list price without telling me it would complete my opponent’s set. The pre-roll desk kept saying “Ready to roll,” even when a mutually useful deal had just become possible. The interesting part was anticipating another player’s move, but the game asked me to reconstruct that from property lists. More animations or extra spaces wouldn’t have fixed that.</p>
<p>The revised helm names missing deeds, the score gap and the rival who stands to complete a set. Trades put both sides on the chart. The remaining limitation is bargaining: a rejection ends the conversation; neither side can counter. That’s the next mechanic worth testing with human opponents, not a change to the rules in this release.</p></section>''')
sim=json.loads((root/'playtest-results.json').read_text())
bots=sim['shippedBotsGrandHarbor']
out.append(f'''<section id="simulation"><h2>Same decisions in the Rust core</h2>
<p>With the same {sim["identicalRollsAndDraws"]} rolls and card draws, my net worth was <b>${sim["tradeAndBuild"][0]}</b> after the trade and build,
<b>${sim["tradeAndKeepCash"][0]}</b> after the trade without building, and <b>${sim["noTradeOrBuild"][0]}</b> without either.
The bots reacted to the actual holdings in each branch. The swap was interesting even though it did not win this seed.</p>
<p>In {bots["completed"]} full-length Grand Harbor games with three shipped bots, {bots["accepted"]} of {bots["proposals"]} proposals were accepted;
{bots["twoDeedOffers"]} were deed-for-deed offers. The swap I enjoyed making is not one these bots initiate.
This measures the controller, not human enjoyment. Reproduce with <code>node tests/playtest.mjs</code> after building.</p></section>''')
survey=json.loads((root/'clicks.json').read_text())
results=json.loads((root/'desktop-results.json').read_text())
actions={k:(start,label,n) for rows in survey['interactions'].values() for k,start,label,n in rows}
scenarios=survey['scenarios']
def table(headers, rows):
    head=''.join(f'<th scope="col">{escape(h)}</th>' for h in headers)
    body=''.join('<tr>'+''.join(f'<td>{escape(str(value))}</td>' for value in row)+'</tr>' for row in rows)
    return '<div class="scroll"><table><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>'
out.append(f'<section id="clicks"><h2>Desktop interaction and scenario audit</h2><p><b>{len(actions)} interactions · {len(scenarios)} scenarios.</b> '
           'The old Activity view hid all balances. The new treasury is independent of the selected instrument; game sheets have their own fixed funds strip. '
           'The board and decision dock do not disappear to show portfolios or history.</p>')
out.append('<p>'+escape(survey['method'])+'</p>')
out.append('<p><b>What still takes effort:</b> from Manage deeds, choosing a nondefault build and confirming takes three clicks including entry, down from four via the old select. Selecting the desired buildable tile directly skips the entry click. '
           'Changing a map and one controller costs seven clicks from play; these infrequent controls stay out of quick start. '
           'Leaving an active network match costs three: the last confirmation protects every device. '
           'Budgets measure effort, not enjoyment; they are not human playtest results.</p>')
obs=results['observed'].copy()
for file in ('property-results.json','charter-results.json','dispatch-results.json','stakes-results.json','trade-results.json','district-results.json','boards-results.json'):
    obs.update(json.loads((root/file).read_text())['observed'])
criteria=survey['criteria']
for c in criteria:
    if not set(c['scenarios'])<=obs.keys():raise ValueError(f'Missing measured paths for {c["id"]}')
    out.append(f'<h3 id="{escape(c["id"])}">{escape(c["name"])}</h3><p>{escape(c["rule"])}</p>')
    if c['id']=='district-identity':out.append('<p>Ignore the top third and remove color. On each remaining third, the browser checks for visible engraving around the title, excluding prices, stamps and ship pieces. The combined samples must match their own named print more closely than any other. This includes both legs of a pending trade and a complete set. A header stripe cannot pass. <a href="#group3">Compare the faces.</a></p>')
    if c['id']=='ownership-mark':out.append('<p><a href="#group3">Compare Shipyards before and after the accepted trade and sale.</a> These are the actual board tiles; no separate SET stamp or extra frame appears.</p>')
    if c['id']=='read-through-handoff':out.append('<p>The browser observes the text for six seconds across handoff on each device, takes the next turn and checks that the letter clears without input. Activity recovers the same recipient, bill and cash afterward. <a href="#group1">See the letters.</a></p>')
    if c['id']=='board-target-preview':out.append('<p>Trades were in the click inventory, but not in this criterion. The old modal passed without showing a single target. The build now requires every deed-targeting Rust command, including the proposal payload and its responses, to appear in a linked scenario. <a href="#group4">See the two-sided trade.</a></p>')
def criterion_for(scope,key):
    return ', '.join(c['name'] for c in criteria if key in c[scope]) or '—'
out.append(f'<h3>Scenario inventory</h3><p>{len(obs)} paths below counted trusted pointer events in Chromium. Other counts are traced through the shipped controls. '
           'Keyboard typing and shortcuts are not silently substituted for required mouse activations.</p>')
rows=[]
for key,start,goal,path,budget in scenarios:
    count=sum(actions[a][2] for a in path.split())
    if key in obs and count!=obs[key]:raise ValueError(f'Stale browser count: {key}')
    rows.append([goal,start,count,budget,' → '.join(path.split()),'Browser counted' if key in obs else 'Control trace',criterion_for('scenarios',key)])
out.append(table(['Goal','Starting state','Clicks','Budget','Interaction IDs','Evidence','UX criterion'],rows))
out.append('<h3>Interaction inventory</h3>')
for group,entries in survey['interactions'].items():
    out.append(f'<details><summary>{escape(group)} ({len(entries)})</summary>'+table(['ID','Starting state','Action / result','Clicks','UX criterion'],[row+[criterion_for('interactions',row[0])] for row in entries])+'</details>')
out.append('</section><section id="contrast"><h2>Palette and measured contrast</h2><p>Navy surrounds the controls, cream is the reading surface, amber marks action and selection. '
           'Seat numbers, underlines, signed amounts and labeled buttons also carry meaning without color. '
           'Ratios use rendered CSS pairs for flat surfaces. For tile titles, the review hides only the lettering and measures the worst pixel behind each name on Grand Harbor. This is not a whole-app accessibility certification. '
           'The guardrails are 4.5:1 for sampled text and 3:1 for the focus outline.</p>')
out.append(table(['Surface','Foreground','Background','Measured','Minimum'],[[name,v['fg'],v['bg'],f"{v['ratio']:.2f}:1",f"{v['minimum']}:1"] for name,v in results['contrast'].items()])+'</section>')
owner_contrast=json.loads((root/'boards-results.json').read_text())['ownerContrast']
out.append('<p>White owner lettering against each rendered seat-colored title band: '+', '.join(f'Seat {i}: {n:.2f}:1' for i,n in enumerate(owner_contrast,1))+'.</p>')
out.append('<section id="motion"><h2>Watch a turn, with sound</h2><p>An actual local game: Seat 1 rolls, opens Copper Yard to bids, and wins it for $10 when Seat 2 withdraws. The rattling dice, bid and closing gavel are recorded from the game.</p><video controls playsinline preload="metadata" style="width:100%;max-width:900px" aria-label="Roll, bidding and settlement with the game audio" src="./table-in-motion.webm"></video></section>')
inventory=json.loads((root.parent/'web/interactions.json').read_text())
out.append('<section id="inventory"><h2>Interaction review checklist</h2><details><summary>Visual priorities, commands and non-game interactions</summary><h3>Space identifiers</h3><dl>')
for name, note in inventory['identifiers']:
    out.append(f'<dt><b>{escape(name)}</b></dt><dd>{escape(note)}</dd>')
out.append('</dl><h3>Accepted commands</h3><ul>')
for name, note, cue in inventory['commands'].values():
    out.append(f'<li><b>{escape(name)}</b>: {escape(note)} · sound: {escape(cue)}</li>')
out.append('</ul><h3>Other interactions</h3><ul>')
for name, note in inventory['surfaces']:
    out.append(f'<li><b>{escape(name)}</b>: {escape(note)}</li>')
out.append('</ul></details></section>')
for i, (section, rows) in enumerate(sections.items()):
    out.append(f'<section id="group{i}"><h2>{escape(section)}</h2><div class="grid">')
    for file, title, finding in rows:
        source=root/f'{file}.png'
        if source.is_file() or escape(title) not in published:
            image=Image.open(source).convert('RGB')
            image.thumbnail((1440, 1000))
            buf=BytesIO()
            image.save(buf,'WEBP',quality=86,method=5)
            data=b64encode(buf.getvalue()).decode()
        else:
            data=published[escape(title)]
        out.append(f'<article><h3>{escape(title)}</h3><details><summary>Inspect capture<img src="data:image/webp;base64,{data}" alt="{escape(title)} in the running game"></summary></details><p>{escape(finding)}</p></article>')
    out.append('</div></section>')
out.append('</main></html>')
report.write_text('\n'.join(out))
