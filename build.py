import base64
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
subprocess.run(["cargo", "build", "--locked", "--release", "--target",
                "wasm32-unknown-unknown"], cwd=root, check=True)
web = root / "web"
wasm = root / "target/wasm32-unknown-unknown/release/harbor_deeds.wasm"
html = (web / "index.html").read_text()
for marker, value in {
    "/*STYLE*/": (web / "style.css").read_text(),
    "__RULES__": (web / "rules.json").read_text(),
    "__WASM__": base64.b64encode(wasm.read_bytes()).decode(),
    "/*APP*/": (web / "strategy.mjs").read_text() + "\n" + (web / "app.js").read_text(),
}.items():
    html = html.replace(marker, value)
(root / "dist").mkdir(exist_ok=True)
(root / "dist/index.html").write_text(html)
