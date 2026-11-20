"""Render a deliberately crowded snapshot using the real tile renderer."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
fixture = """
session.abort();
initialize(['human','human','human','human'],'grand',0,1,'even');
const index=rules.tiles.findIndex(t=>t.name==='Glass Strand');
state.players.forEach(p=>p.pos=index);
state.owners[index]=0;state.levels[index]=3;state.rents[index]=168;
render();selectSpace(index);
"""
html=(root.parent/'dist/index.html').read_text().replace('await initialGame;',fixture)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    page=browser.new_page(reduced_motion='reduce')
    page.route('http://review.test/',lambda route: route.fulfill(body=html,content_type='text/html'))
    page.goto('http://review.test/')
    target=page.get_by_role('button',name='Glass Strand',exact=False)
    target.locator('.flag').wait_for()
    for w,h in [(1024,680),(801,610),(390,844),(320,680)]:
        page.set_viewport_size({'width':w,'height':h})
        assert target.locator('.token').count()==4
        assert 'level 3' in target.get_attribute('aria-label')
        # Test child boundaries, not scrollWidth: centered overflow can clip on the left.
        bad=target.evaluate("""el=>{const box=el.getBoundingClientRect();return [...el.querySelectorAll('*')].filter(n=>{
          const r=n.getBoundingClientRect();return r.width>0&&(r.left<box.left-.5||r.right>box.right+.5||r.top<box.top-.5||r.bottom>box.bottom+.5)
        }).map(n=>n.textContent)}""")
        assert not bad,(w,bad)
        if w==390: target.screenshot(path=root/'crowded-space.png')
    browser.close()
