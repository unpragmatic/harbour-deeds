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
    "/*STYLE*/": "\n".join((web / name).read_text() for name in ["style.css","table.css"]),
    "__RULES__": (web / "rules.json").read_text(),
    "__OUTER__": json.dumps(expanded),
    "__GRAND__": json.dumps(dict(expanded, **json.loads((web / "grand-harbor.json").read_text()))),
    "__WASM__": base64.b64encode(wasm.read_bytes()).decode(),
    "/*APP*/": "const uxInventory="+(web/"interactions.json").read_text()+";\n"+"\n".join((web / name).read_text() for name in ["strategy.mjs","foley.js","feedback.js","room.js","app.js"]),
}.items():
    html = html.replace(marker, value)
commands = re.search(r'enum Command \{(.*?)\n\}', (root/'src/lib.rs').read_text(), re.S)[1]
variants = {s.lower() for s in re.findall(r'^    (\w+)\s*[\({]', commands, re.M)}
documented = set(json.loads((web/'interactions.json').read_text())['commands'])
if variants != documented:
    raise ValueError(f'Update web/interactions.json for engine commands: {variants ^ documented}')
(root / "dist").mkdir(exist_ok=True)
(root / "dist/index.html").write_text(html)
peer = root / "node_modules/peerjs"
(root / "dist/peerjs.min.js").write_bytes((peer / "dist/peerjs.min.js").read_bytes())
(root / "dist/peerjs-LICENSE.txt").write_bytes((peer / "LICENSE").read_bytes())
