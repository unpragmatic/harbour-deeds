import base64
import json
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
subprocess.run(["cargo", "build", "--locked", "--release", "--target",
                "wasm32-unknown-unknown"], cwd=root, check=True)
web = root / "web"
wasm = root / "target/wasm32-unknown-unknown/release/harbor_deeds.wasm"
html = (web / "index.html").read_text()
base = json.loads((web / "rules.json").read_text())
outer = json.loads((web / "outer-harbor.json").read_text())
adds = {row["after"]: row["tiles"] for row in outer["inserts"]}
expanded = dict(base, salary=outer["salary"], tiles=[
    space for t in base["tiles"] for space in [t, *adds.get(t["name"], [])]
])
expanded["development"] = dict(base["development"], levels=[
    dict(level, cost_pct=cost) for level, cost in
    zip(base["development"]["levels"], outer["development_cost_pct"], strict=True)
])
for marker, value in {
    "/*STYLE*/": "\n".join((web / name).read_text() for name in ["style.css","table.css","workspace.css","bridge.css","dispatch.css","trade.css"]),
    "__CHART__": (web/"harbor-chart.svg").read_text(),
    "__RULES__": (web / "rules.json").read_text(),
    "__OUTER__": json.dumps(expanded),
    "__LEGACY__": (web/"edition-launch.json").read_text(),
    "__GRAND__": json.dumps(dict(expanded, **json.loads((web / "grand-harbor.json").read_text()))),
    "__WASM__": base64.b64encode(wasm.read_bytes()).decode(),
    "/*APP*/": "const uxInventory="+(web/"interactions.json").read_text()+";\n"+"\n".join((web / name).read_text() for name in ["strategy.mjs","foley.js","feedback.js","room.js","property-desk.js","trade.js","app.js"]),
}.items():
    html = html.replace(marker, value)
core=(root/'src/lib.rs').read_text()
commands = re.search(r'enum Command \{(.*?)\n\}', core, re.S)[1]
variants = {s.lower() for s in re.findall(r'^    (\w+)\s*[\({]', commands, re.M)}
documented = set(json.loads((web/'interactions.json').read_text())['commands'])
if variants != documented:
    raise ValueError(f'Update web/interactions.json for engine commands: {variants ^ documented}')
survey=json.loads((root/'review/clicks.json').read_text())
actions=[(key,count) for rows in survey['interactions'].values() for key,_,_,count in rows]
costs=dict(actions)
if len(actions)!=len(costs) or not variants<=costs.keys() or any(type(n)!=int or n<0 for n in costs.values()):
    raise ValueError('Provide a unique interaction and click count for every engine command in review/clicks.json')
seen=set()
for key,_,_,steps,budget in survey['scenarios']:
    if key in seen or sum(costs[a] for a in steps.split())>budget:
        raise ValueError(f'Duplicate scenario or exceeded click budget: {key}')
    seen.add(key)
for criterion in survey['criteria']:
    if not criterion['rule'] or not set(criterion['interactions'])<=costs.keys() or not set(criterion['scenarios'])<=seen:
        raise ValueError(f'Unmapped interaction or scenario in {criterion["id"]}')
# A named payload (e.g. Propose(Trade)) targets deeds just as an inline tile field does.
targeted={'accept','reject'}
for variant,fields,payload in re.findall(r'^    (\w+)(?:\s*\{([^}]*)\}|\((\w+)\))',commands,re.M):
    if payload:
        fields=re.search(rf'struct {payload} \{{(.*?)\n\}}',core,re.S)[1]
    if re.search(r'\b(?:tile|[\w]*deed)\s*:',fields):targeted.add(variant.lower())
board=next(c for c in survey['criteria'] if c['id']=='board-target-preview')
exercised={a for key,_,_,steps,_ in survey['scenarios'] if key in board['scenarios'] for a in steps.split()}
missing=targeted-(set(board['interactions'])&exercised)
if missing:raise ValueError(f'Deed commands need a board criterion and scenario, not just a click budget: {missing}')
(root / "dist").mkdir(exist_ok=True)
(root / "dist/index.html").write_text(html)
peer = root / "node_modules/peerjs"
(root / "dist/peerjs.min.js").write_bytes((peer / "dist/peerjs.min.js").read_bytes())
(root / "dist/peerjs-LICENSE.txt").write_bytes((peer / "LICENSE").read_bytes())
