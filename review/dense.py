"""Render a deliberately crowded snapshot using the real tile renderer."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent
fixture = """
session.abort();
initialize(['human','human','human','human'],'grand',0,1,'even');
const index=rules.tiles.findIndex(t=>t.name==='Glass Strand');
state.players.forEach(p=>p.pos=index);
for(const i of districtTiles(rules.tiles[index].group))state.owners[i]=0;
state.levels[index]=3;state.rents[index]=168;
render();selectSpace(index);
"""
html=(root.parent/'dist/index.html').read_text().replace('await initialGame;',fixture)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    page=browser.new_page(reduced_motion='reduce')
    page.route('http://review.test/',lambda route: route.fulfill(body=html,content_type='text/html'))
    page.goto('http://review.test/')
    target=page.locator('#board').get_by_role('button',name='Glass Strand',exact=False)
    target.locator('.ownerMark').wait_for()
    for w,h in [(1440,1000),(1200,941),(1280,900),(1101,741),(1366,768),(1200,720),(1024,680),(801,610),(390,844),(320,680)]:
        page.set_viewport_size({'width':w,'height':h})
        assert target.locator('.token').count()==4
        assert 'level 3' in target.get_attribute('aria-label')
        # Test child boundaries, not scrollWidth: centered overflow can clip on the left.
        bad=target.evaluate("""el=>{const box=el.getBoundingClientRect();return [...el.querySelectorAll('*')].filter(n=>{
          const r=n.getBoundingClientRect();return r.width>0&&(r.left<box.left-.5||r.right>box.right+.5||r.top<box.top-.5||r.bottom>box.bottom+.5)
        }).map(n=>n.textContent)}""")
        assert not bad,(w,bad)
        clash=target.evaluate("""el=>{const r=s=>el.querySelector(s).getBoundingClientRect(),owner=r('.ownerMark');
          return ['.districtMark','strong','.tileValue','.berth'].filter(s=>{const n=r(s);
            return Math.min(owner.right,n.right)>Math.max(owner.left,n.left)+.5&&
              Math.min(owner.bottom,n.bottom)>Math.max(owner.top,n.top)+.5})}""")
        assert not clash,(w,h,clash)
        if w==390: target.screenshot(path=root/'crowded-space.png')
    browser.close()
