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
    prints=json.loads((root/'web/district-prints.json').read_text())
    widths={g:v['width'] for g,v in prints.items()}
    def photos():
        snap=lambda:Image.open(BytesIO(p.screenshot())).convert('L')
        ink=snap()
        flat_style=p.add_style_tag(content='.deedFace{background-image:none!important}')
        flat=snap()
        flat_style.evaluate('e=>e.remove()')
        return ink,flat
    def templates_from_key(img,groups):
        samples={}
        for g in groups:
            box=p.locator('#printKey>div').filter(has_text=g).locator('.engraving').bounding_box()
            x,y=round(box['x'])+1,round(box['y'])+1
            sample=img.crop((x,y,x+widths[g],y+12))
            low,high=sample.getextrema()
            assert high-low>=70,(g,low,high)
            samples[g]=tuple(v<(low+high)/2 for v in sample.tobytes())
        return samples
    def body_print(i,group,images,templates):
        tile=p.locator(f'#tile-{i}')
        box=tile.bounding_box()
        frame=tile.locator('.deedFace').bounding_box()
        labels=tile.locator('.tileValue,.districtMark,.ownerMark,.token,.station').evaluate_all(
            'els=>els.map(e=>e.getBoundingClientRect().toJSON()).filter(r=>r.width)')
        x0,y0=round(frame['x']),round(frame['y'])
        ink,flat=images
        samples=[]
        # Ignore the top third entirely. Each remaining third must have visible ink
        # even after allocating space for lettering, stamps, focus and ship pieces.
        for third in (1,2):
            eligible=marked=0
            for yy in range(round(box['y']+third*box['height']/3),round(box['y']+(third+1)*box['height']/3)-2):
                for xx in range(round(box['x'])+2,round(box['x']+box['width'])-2):
                    eligible+=1
                    if not (x0+2<=xx<x0+frame['width']-2 and y0+2<=yy<y0+frame['height']-2):continue
                    if any(r['left']-1<=xx<=r['right']+1 and r['top']-1<=yy<=r['bottom']+1 for r in labels):continue
                    # Ignore lettering, but not the exposed paper between glyphs.
                    if flat.getpixel((xx,yy))<150:continue
                    mark=flat.getpixel((xx,yy))-ink.getpixel((xx,yy))>19
                    samples.append((xx-x0,yy-y0,mark));marked+=mark
            assert marked>=max(2,eligible*.035),(i,group,third,marked,eligible)
        def loss(g):
            pat,w=templates[g],widths[g]
            return min(sum(pat[((y+dy)%12)*w+(x+dx)%w]!=v for x,y,v in samples)/len(samples)
                       for dx in (-1,0,1) for dy in (-1,0,1))
        scores={g:loss(g) for g in templates}
        assert scores[group]+.04<min(v for g,v in scores.items() if g!=group),(i,group,scores)

    def print_pairs(tiles,mono):
        color=Image.open(BytesIO(p.screenshot())).convert('RGB')
        plate=Image.new('RGB',(4*166,2*95),'#302d29')
        def capture(img,selector,cut_header=False):
            r=p.locator(selector).bounding_box()
            return img.crop((round(r['x']),round(r['y']+r['height']/3*cut_header),
                             round(r['x']+r['width']),round(r['y']+r['height'])))
        for j,g in enumerate(prints):
            a,b,*_= [i for i,t in enumerate(tiles) if t.get('group')==g]
            x,y=j%4*166+8,j//4*95+4
            left=capture(color,f'#tile-{a}')
            right=capture(mono,f'#tile-{b}',True)
            plate.paste(left,(x,y));plate.paste(right,(x+75,y+left.height-right.height))
            key=p.locator('#printKey>div').filter(has_text=g).bounding_box()
            plate.paste(color.crop(tuple(round(v) for v in (key['x'],key['y'],key['x']+key['width'],key['y']+key['height']))),(x,y+left.height+3))
        plate.resize((plate.width*2,plate.height*2),Image.Resampling.NEAREST).save(review/'district-pairs.png')

    def ownership(i,owner,held=0,size=3):
        tile=p.locator(f'#tile-{i}')
        mark=tile.locator('.ownerMark')
        if owner is None:
            expect(mark).to_have_count(0)
            assert 'Unowned' in tile.get_attribute('aria-label')
            return
        expect(mark).to_have_text(f'S{owner} '+('SET' if held==size else f'{held}/{size}'))
        assert f'Owned by Seat {owner}' in tile.get_attribute('aria-label')
        assert f'{held} of {size} {tiles[i]["group"]} deeds' in tile.get_attribute('aria-label')
        for part in ('b','span'):visible(f'#tile-{i} .ownerMark {part}')
    def shipyards_row():
        img=Image.open(BytesIO(p.screenshot())).convert('RGB')
        boxes=[p.locator(f'#tile-{i}').bounding_box() for i in [11,12,14]]
        w,h=round(boxes[0]['width'])+3,round(boxes[0]['height'])
        row=Image.new('RGB',(3*w-3,h),'#37322b')
        for j,r in enumerate(boxes):
            x,y=round(r['x']),round(r['y'])
            row.paste(img.crop((x,y,x+w-3,y+h)),(j*w,0))
        return row

    monochrome(True)
    for board in ('compact','outer','grand'):
        tiles=table(board)
        images=photos()
        visible('#printKey>div')
        templates=templates_from_key(images[0],{t['group'] for t in tiles if t['kind']=='deed'})
        assert p.locator('.special .deedFace').count()==0
        expect(p.locator('.ownerMark')).to_have_count(0)
        for i,t in enumerate(tiles):
            if t['kind']!='deed':continue
            tile=p.locator(f'#tile-{i}')
            visible(f'#tile-{i} .printCode')
            assert t['group'] in tile.get_attribute('aria-label')
            expect(tile.locator('.printCode')).to_have_text(prints[t['group']]['code'])
            body_print(i,t['group'],images,templates)
    seen['match-print']=p.evaluate('inputs')
    seen['header-free']=p.evaluate('inputs')
    shot('district-grayscale')
    monochrome(False)
    print_pairs(tiles,images[0])
    # These are accepted Rust commands from the design match, not invented ownership.
    table('grand',moves[:swap+1])
    rows=[shipyards_row()]
    monochrome(True)
    for i,owner,held in [(11,1,2),(12,1,2),(14,3,1),(29,1,1)]:
        ownership(i,owner,held)
    seen['split-owner']=p.evaluate('inputs')
    images=photos()
    for i,leg in [(14,'GIVE'),(29,'GET')]:
        expect(p.locator(f'#tile-{i} .tileValue')).to_contain_text(leg)
        visible(f'#tile-{i} .tileValue')
        body_print(i,tiles[i]['group'],images,templates)
    seen['trade-print']=p.evaluate('inputs')
    p.set_viewport_size({'width':320,'height':680})
    p.locator('#board.route').wait_for()
    ownership(14,3,1);ownership(29,1,1)
    visible('#tile-29 .token');visible('#tile-29 .printName')
    p.set_viewport_size({'width':1366,'height':768})
    p.locator('#board:not(.route)').wait_for()
    monochrome(False)
    table('grand',moves[:swap+2])
    for i in [11,12,14,26,27,29]:
        ownership(i,1 if i<26 else 3,3)
        for part in ['.tileValue','strong']:visible(f'#tile-{i} {part}')
    rows.append(shipyards_row())
    expect(p.locator('.ownerMark.complete')).to_have_count(6)
    seen['read-full-set']=p.evaluate('inputs')
    shot('district-sets')
    monochrome(True)
    images=photos()
    for i in [11,12,14,26,27,29]:body_print(i,tiles[i]['group'],images,templates)
    table('grand',moves[:swap+2]+[{'action':'sell','actor':0,'tile':14}])
    expect(p.locator('.ownerMark.complete')).to_have_count(3)
    ownership(11,1,2);ownership(12,1,2);ownership(14,None)
    ownership(29,3,3)
    seen['release-title']=p.evaluate('inputs')
    monochrome(False)
    rows.append(shipyards_row())
    w,h=rows[0].size
    chart=Image.new('RGB',(w,len(rows)*(h+3)-3),'#37322b')
    for j,row in enumerate(rows):chart.paste(row,(0,j*(h+3)))
    chart.resize((chart.width*2,chart.height*2),Image.Resampling.NEAREST).save(review/'ownership-changes.png')
    expect(p.locator('#tile-14 .printCode')).to_have_text('SY')
    # First two rows of the folded board include all Old Town deeds and a dispatch between them.
    table('grand')
    p.set_viewport_size({'width':1120,'height':650});p.locator('#board.route').wait_for()
    assert p.locator('#board .tile').evaluate_all('ns=>ns.every(n=>n.getBoundingClientRect().width>=80)')
    p.set_viewport_size({'width':390,'height':844});monochrome(True)
    for i in [1,3,4]:
        visible(f'#tile-{i} .printName')
        expect(p.locator(f'#tile-{i} .printName')).to_have_text('Old Town')
    expect(p.locator('#tile-2 .deedFace')).to_have_count(0)
    images=photos()
    for i in [1,3,4]:body_print(i,'Old Town',images,templates)
    seen['match-print-phone']=p.evaluate('inputs')
    shot('district-phone')
    assert not any(seen.values()),seen
    (review/'district-results.json').write_text(json.dumps({'observed':seen},indent=2)+'\n')
    browser.close()
