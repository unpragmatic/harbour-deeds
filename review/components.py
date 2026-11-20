"""Generate the one-page illustrated review from the local and multiplayer UI walkthroughs."""
from base64 import b64encode
from html import escape
import json
from io import BytesIO
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
sections = {
    'Set up a table': [
        ('modes', 'Mode picker', 'Keep the four play modes visible. Common local games start immediately; customization is secondary.'),
        ('settings', 'Local settings', 'Board and clock apply to the whole table; seat selectors choose the controllers. A future improvement is a short roster summary before Start.'),
        ('join', 'Join by code', 'One input accepts a typed or pasted six-character code. Explicit submission lets players correct it before connecting.'),
        ('host-lobby', 'Host lobby', 'Keep the invitation code beside Copy. Connected devices receive seats automatically, with individual overrides for shared devices.'),
        ('guest-wait', 'Guest waiting room', 'Identify the table and joining device. Showing the guest their provisional seat assignments before launch would reduce uncertainty.'),
        ('recovery', 'Interrupted table', 'Distinguish a paused network table from a completed match. A returning device needs a recovery action, not a fresh local game.'),
    ],
    'Navigate and inspect': [
        ('crowded-space', 'Four visitors on an improved deed', 'Density fixture: the name and current rent remain visible above the owner flag and four seat discs. The inspector carries the development ladder instead of squeezing it onto the tile.'),
        ('grand-harbor', 'Grand Harbor circuit', 'The 40-space circuit distinguishes guilds, dispatches, exchanges, fees and deed districts. Inspect a space to read its effect.'),
        ('grand-chart', 'Pocket chart', 'On small devices the larger circuit becomes a scrollable route in movement order, instead of squeezing eleven columns into a phone screen.'),
        ('workbench', 'Purchase decision on desktop', 'The landed deed opens beside the board. See every tier’s construction cost, total rent and incremental payoff before buying or opening an auction.'),
        ('table', 'Board, turns and balances', 'Keep movement and cash visible together on desktop. The decision dock stays available when switching views on a phone.'),
        ('deed', 'Deed inspection', 'The owner or market status now comes first; price, base rent and full-district rent are aligned for comparison.'),
        ('players', 'Player portfolios', 'Show cash and district counts together. A future improvement is opening an owned deed directly from the portfolio.'),
        ('activity', 'Activity feed', 'Keep history newest-first and available without dismissing the turn. Round dividers would make long matches easier to scan.'),
        ('help', 'Rulebook', 'Keep rules one tap away without leaving the table. The decision dock carries the immediate action rather than requiring a rulebook lookup.'),
    ],
    'Make a market decision': [
        ('offer', 'Deed offer', 'Show the cash left after purchase alongside rent. Bid at auction remains a distinct alternative to buying at list price.'),
        ('phone-auction', 'Timed bid', 'A shrinking bar and numeric countdown show the remaining window; the last two seconds change color. Keep bid presets and withdrawal reachable without a keyboard.'),
        ('custom-bid', 'Custom bid', 'Show the legal range before numeric entry. A custom bid never commits until submitted; online, the host clock still applies.'),
        ('bid', 'Bidder handoff', 'Keep the leader and acting seat separate. The amount on each bid button is the actual commitment, not an increment.'),
        ('draft', 'Trade composer', 'Start from an editable deed-for-cash offer. Sending stays explicit, and the player can cancel without using their proposal.'),
        ('trade', 'Trade response', 'Label each side from the recipient’s perspective. Accept and decline remain side by side.'),
    ],
    'Settle the game': [
        ('settled', 'Settlement', 'Show the outcome, then advance automatically. The activity feed preserves results that go by too quickly.'),
        ('final', 'Final accounts', 'Show the winner and each seat’s net worth. Local rematch reuses settings instead of reopening setup.'),
    ],
    'Develop a district': [
        ('build-even', 'Build or hold', 'Compare cash left after construction with the rent per visit. Keep cash dismisses the quote without spending or advancing the turn.'),
        ('build-district', 'Whole-district quote', 'Show the full purchase cost and the range earned from one paying visitor. A visitor lands on only one deed, not the whole district.'),
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
details[open] summary{cursor:zoom-out}details[open] img{height:auto}summary:focus-visible,a:focus-visible{outline:3px solid #ad6d1b}small{color:#496354}</style>
<main><a href="./">← Play Harbor Deeds</a><h1>Component overview</h1><p>A visual walkthrough of the decisions, handoffs and recovery screens. Select any capture to expand it.</p><nav>''']
for i, section in enumerate(sections):
    out.append(f'<a href="#group{i}">{escape(section)}</a>')
out.append('</nav>')
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
        image = Image.open(root/f'{file}.png').convert('RGB')
        image.thumbnail((960, 1000))
        buf = BytesIO()
        image.save(buf, 'WEBP', quality=86, method=5)
        data = b64encode(buf.getvalue()).decode()
        out.append(f'<article><h3>{escape(title)}</h3><details><summary>Inspect capture<img src="data:image/webp;base64,{data}" alt="{escape(title)} in the running game"></summary></details><p>{escape(finding)}</p></article>')
    out.append('</div></section>')
out.append('</main></html>')
(root.parent/'docs/components.html').write_text('\n'.join(out))
