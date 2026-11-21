"""Verify district membership from the printed board, with color removed."""
import json
import subprocess
from io import BytesIO
from pathlib import Path
from PIL import Image
from playwright.sync_api import expect, sync_playwright

review=Path(__file__).resolve().parent
root=review.parent
html=(root/'dist/index.html').read_text()
moves=json.loads(subprocess.check_output(['node','tests/playtest.mjs','--journal'],cwd=root))['moves']
swap=next(i for i,m in enumerate(moves) if m.get('take_deed')==14 and m.get('give_deed')==29)
assert moves[swap+1]=={'action':'accept','actor':2}
anchor='engine=(await WebAssembly.instantiate(bytes)).instance.exports;'
assert html.count(anchor)==1
html=html.replace(anchor,anchor+'''
window.printTable=(map,moves)=>{
  session?.abort();initialize(['human','human','human'],map,0,1,'even',currentEdition,
    {victory:'net_worth',rounds:8,deeds:false,improvements:false});
  const journal={seq:0};for(const m of moves)replay(journal,m);render();
  session=new AbortController();if(state.phase==='roll')controllers.human(state,session.signal);
  return rules.tiles;
};''')
seen={}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    p=browser.new_page(viewport={'width':1366,'height':768},reduced_motion='reduce')
    p.add_init_script('window.inputs=0;for(const e of ["click","keydown","wheel","pointerdown","touchstart"])addEventListener(e,v=>{if(v.isTrusted)inputs++},true)')
    p.route('http://harbor.test/',lambda r:r.fulfill(body=html,content_type='text/html'))
    p.goto('http://harbor.test/')
    cdp=p.context.new_cdp_session(p)
    def monochrome(on):
        cdp.send('Emulation.setEmulatedVisionDeficiency',{'type':'achromatopsia' if on else 'none'})
    def visible(selector):
        assert p.locator(selector).evaluate_all('''ns=>ns.length>0&&ns.every(n=>{
          const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth+.5&&
            r.top>=0&&r.bottom<=innerHeight+.5&&n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))
        })'''),selector
    def shot(name):p.screenshot(path=review/(name+'.png'))
    def table(board,commands=()):
        return p.evaluate('([board,moves])=>printTable(board,moves)',[board,commands])
    def signature(img,box):
        assert box['width']>=20 and box['height']>=10,box
        x,y=round(box['x'])+1,round(box['y']+box['height']/2)-5
        sample=img.crop((x,y,x+18,y+10)).convert('L')
        low,high=sample.getextrema()
        assert high-low>=70,(low,high)
        return tuple(v<(low+high)/2 for v in sample.tobytes())
    def distance(a,b):
        return sum(x!=y for x,y in zip(a,b))/len(a)

    monochrome(True)
    for board in ('compact','outer','grand'):
        tiles=table(board)
        img=Image.open(BytesIO(p.screenshot()))
        visible('#printKey>div')
        templates={}
        for g in dict.fromkeys(t['group'] for t in tiles if t['kind']=='deed'):
            key=p.locator('#printKey>div').filter(has_text=g)
            templates[g]=signature(img,key.locator('.engraving').bounding_box())
        assert p.locator('.special .districtBand').count()==0
        for i,t in enumerate(tiles):
            if t['kind']!='deed':continue
            tile=p.locator(f'#tile-{i}')
            visible(f'#tile-{i} .printCode');visible(f'#tile-{i} .engraving')
            assert t['group'] in tile.get_attribute('aria-label')
            sig=signature(img,tile.locator('.engraving').bounding_box())
            distances={group:distance(sig,sample) for group,sample in templates.items()}
            best=min(distances,key=distances.get)
            assert best==t['group'] and distances[best]+.07<min(v for k,v in distances.items() if k!=best),(t['name'],distances)
    seen['match-print']=p.evaluate('inputs')
    shot('district-grayscale')
    monochrome(False)
    # These are accepted Rust commands from the design match, not invented ownership.
    table('grand',moves[:swap+1])
    expect(p.locator('.setStamp')).to_have_count(0)
    table('grand',moves[:swap+2])
    for i in [11,12,14,26,27,29]:
        for part in ['.setStamp','.flag','.engraving','.tileValue','strong']:visible(f'#tile-{i} {part}')
    expect(p.locator('.setStamp')).to_have_count(6)
    seen['read-full-set']=p.evaluate('inputs')
    shot('district-sets')
    table('grand',moves[:swap+2]+[{'action':'sell','actor':0,'tile':14}])
    expect(p.locator('.setStamp')).to_have_count(3)
    for i in [11,12,14]:expect(p.locator(f'#tile-{i} .setStamp')).to_have_count(0)
    expect(p.locator('#tile-14 .printCode')).to_have_text('SY')
    # First two rows of the folded board include all Old Town deeds and a dispatch between them.
    table('grand')
    p.set_viewport_size({'width':1120,'height':650});p.locator('#board.route').wait_for()
    assert p.locator('#board .tile').evaluate_all('ns=>ns.every(n=>n.getBoundingClientRect().width>=80)')
    p.set_viewport_size({'width':390,'height':844});monochrome(True)
    for i in [1,3,4]:
        visible(f'#tile-{i} .printName');visible(f'#tile-{i} .engraving')
        expect(p.locator(f'#tile-{i} .printName')).to_have_text('Old Town')
    expect(p.locator('#tile-2 .districtBand')).to_have_count(0)
    seen['match-print-phone']=p.evaluate('inputs')
    shot('district-phone')
    assert not any(seen.values()),seen
    (review/'district-results.json').write_text(json.dumps({'observed':seen},indent=2)+'\n')
    browser.close()
