"""Revisit three decisions from the eight-round design playtest, using accepted game commands."""
from pathlib import Path
import json
import subprocess
from playwright.sync_api import sync_playwright, expect

review = Path(__file__).resolve().parent
release = (review.parent/'dist/index.html').read_text()
anchor = "engine=(await WebAssembly.instantiate(bytes)).instance.exports;"
fixture = """
window.revisit=moves=>{
  session?.abort();initialize(['human','bot','bot'],'grand',0,1,'even',currentEdition,
    {victory:'net_worth',rounds:8,deeds:false,improvements:false});
  const journal={seq:0};
  for(const m of moves)replay(journal,m);
  render();session=new AbortController();controllers.human(state,session.signal);
};"""
assert release.count(anchor) == 1
journal=json.loads(subprocess.check_output(['node','tests/playtest.mjs','--journal'],cwd=review.parent))
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    p = browser.new_page(viewport={'width':1366,'height':768}, reduced_motion='reduce')
    p.route('http://harbor.test/',lambda r:r.fulfill(body=release.replace(anchor,anchor+fixture),content_type='text/html'))
    p.add_init_script('window.inputs=0;for(const e of ["click","keydown","wheel","pointerdown"])addEventListener(e,v=>{if(v.isTrusted)inputs++},true)')
    p.goto('http://harbor.test/')
    observed={}
    for stop, pattern, check in [
        ('chase','One short of Shipyards. Spar Yard · Unowned, $190.','At $815 the current actor is $148 behind Seat 2'),
        ('block','Last Exchange deed. If Seat 3 gets it, the set is complete. Grain Quay rent: $58 → $116.','An unowned rival target changes the value of buying'),
        ('price-out','Last Shipyards deed. If Seat 1 gets it, the set is complete. Spar Yard rent: $48 → $96.','At $125 I cannot raise the $150 bid on the deed I wanted'),
    ]:
        p.evaluate('m=>revisit(m)',journal['moves'][:journal['markers'][stop]])
        stake=p.locator('#turn .stakes')
        expect(stake,check).to_have_text(pattern)
        if stop=='chase':expect(p.locator('#turn .race'),check).to_have_text('Net worth $815 · $148 behind Seat 2')
        if stop=='price-out':expect(p.locator('#actions button:enabled')).to_have_text(['Withdraw'])
        for w,h in [(390,844),(1366,768)]:
            p.set_viewport_size({'width':w,'height':h})
            assert stake.evaluate("""el=>{const r=document.createRange();r.selectNodeContents(el);
                return [...r.getClientRects()].every(b=>b.left>=0&&b.right<=innerWidth+.5&&b.top>=0&&b.bottom<=innerHeight+.5&&
                  el.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2))) }"""), (stop,w)
        if stop=='block':p.screenshot(path=review/'rival-stakes.png')
        observed[stop]=p.evaluate('inputs')
    assert not any(observed.values()), observed
    (review/'stakes-results.json').write_text(json.dumps({'observed':observed},indent=2)+'\n')
    browser.close()
