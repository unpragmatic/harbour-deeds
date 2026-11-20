"""Record Chromium's actual surface and the game's own sound bus, without OS screen/mic access."""
import asyncio
from base64 import b64decode
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright, expect

root=Path(__file__).resolve().parent
game=Path(os.environ.get('MOTION_GAME',root.parent/'dist/index.html')).read_text()
out=Path(os.environ.get('MOTION_OUTPUT',root))
out.mkdir(parents=True,exist_ok=True)
movie=(out if 'MOTION_OUTPUT' in os.environ else root.parent/'docs')/'table-in-motion.webm'
tap='''window.tap=audio.createMediaStreamDestination();bus.connect(tap);
window.meter=audio.createAnalyser();bus.connect(meter);'''
assert game.count('bus.connect(audio.destination);')==1

# Frame samples come from the rendered pawn, not the requested animation durations.
track='''() => {
  const tiles=[...document.querySelectorAll('.tile')],start=tiles.findIndex(t=>t.classList.contains('landing'));
  window.journey=new Promise((resolve,reject)=>{
    const begun=performance.now(),wave=new Float32Array(meter.fftSize);
    let came=null,left=null,docked=null,path=[],origin,centers,castPeak=0,dockPeak=0;
    function sample(t){
      const ship=document.querySelector('.sailing');
      if(ship){
        if(came===null)came=t;
        const r=ship.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
        centers??=tiles.map(el=>{const b=el.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]});
        const dist=centers.map(([cx,cy])=>Math.hypot(x-cx,y-cy)),nearest=dist.indexOf(Math.min(...dist));
        if(path.at(-1)!==nearest)path.push(nearest);
        origin??=[x,y];if(left===null&&Math.hypot(x-origin[0],y-origin[1])>5)left=t;
        if(tiles[nearest].classList.contains('landing')&&dist[nearest]<5&&docked===null)docked=t;
        meter.getFloatTimeDomainData(wave);
        for(const value of wave){if(docked!==null)dockPeak=Math.max(dockPeak,Math.abs(value));else if(left===null)castPeak=Math.max(castPeak,Math.abs(value))}
      }else if(came!==null&&left!==null&&docked!==null){
        resolve({departureMs:Math.round(left-came),dockMs:Math.round(docked-came),goneMs:Math.round(t-came),start,path,
          castPeak:+castPeak.toFixed(3),dockPeak:+dockPeak.toFixed(3)});return;
      }
      if(t-begun>6000){reject(new Error('Could not measure the completed voyage: '+path));return}
      requestAnimationFrame(sample)
    }requestAnimationFrame(sample)
  })
}'''

async def main():
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
        page=await browser.new_page(viewport={'width':1366,'height':768})
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        await page.route('http://motion.test/',lambda r:r.fulfill(content_type='text/html',body=game.replace('bus.connect(audio.destination);','bus.connect(audio.destination);'+tap)))
        await page.add_init_script('crypto.getRandomValues=a=>(a[0]=1,a)')
        await page.goto('http://motion.test/')
        await page.click('#setupBtn');await page.click('#passPlay')
        await page.evaluate('''() => {
          const c=document.createElement('canvas');c.width=innerWidth;c.height=innerHeight;
          const ctx=c.getContext('2d'),stream=c.captureStream(30);
          stream.addTrack(tap.stream.getAudioTracks()[0]);window.peak=0;
          window.sample=setInterval(()=>{const a=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(a);
            for(const x of a) window.peak=Math.max(peak,Math.abs(x));},10);
          window.captureFrame=async data=>{const im=new Image();im.src='data:image/jpeg;base64,'+data;
            await im.decode();ctx.drawImage(im,0,0,c.width,c.height)};
          const rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1800000});
          const chunks=[];rec.ondataavailable=e=>chunks.push(e.data);
          window.begin=()=>rec.start();
          window.finish=()=>new Promise(resolve=>{rec.onstop=()=>{clearInterval(sample);const reader=new FileReader();
            reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(new Blob(chunks))};rec.stop()});
        }''')
        cdp=await page.context.new_cdp_session(page)
        first_frame=asyncio.Event()
        async def frame(msg):
            await page.evaluate('captureFrame',msg['data'])
            first_frame.set()
            await cdp.send('Page.screencastFrameAck',{'sessionId':msg['sessionId']})
        cdp.on('Page.screencastFrame',frame)
        await cdp.send('Page.startScreencast',{'format':'jpeg','quality':86})
        await asyncio.wait_for(first_frame.wait(),5)
        await page.evaluate('begin()');await page.wait_for_timeout(600)
        button=lambda name:page.get_by_role('button',name=name,exact=True)
        await expect(page.locator('html')).to_have_attribute('data-motion','standard')
        await page.evaluate(track);await button('Roll dice').click()
        await expect(button('Buy · $140')).to_be_enabled()  # No input gate while the dice are tumbling.
        ship=page.locator('.sailing')
        await expect(ship).to_be_visible()
        await page.wait_for_timeout(1400)
        await page.screenshot(path=out/'motion-roll.png')
        standard=await page.evaluate('journey')
        assert standard['departureMs']>800 and standard['goneMs']-standard['dockMs']>200,standard
        assert standard['path']==list(range(7)),standard
        assert min(standard['castPeak'],standard['dockPeak'])>.004,standard
        await button('Start auction').click();await page.wait_for_timeout(950)
        await button('Bid $10').click();await page.wait_for_timeout(1000)
        await button('Withdraw').click();await page.wait_for_timeout(235)
        await expect(page.locator('#stageTitle')).to_have_text('Sold · $10')
        await page.screenshot(path=out/'motion-sale.png')
        await page.wait_for_timeout(950)
        await page.click('#prefsBtn');await page.check('[name=motionPace][value=fast]')
        await expect(page.locator('#motionStatus')).to_contain_text('Fast is active')
        await page.screenshot(path=out/'motion-settings.png')
        await page.click('#close');await page.click('#setupBtn');await page.click('#passPlay')
        await page.evaluate(track);await button('Roll dice').click()
        fast=await page.evaluate('journey')
        # A dropped compositor frame is possible on the fast trip, but never a reversed or unrelated berth.
        assert fast['path']==sorted(set(fast['path'])) and fast['path'][0]==0 and fast['path'][-1]==6,fast
        assert len(fast['path'])>=4 and fast['dockMs']<standard['departureMs'],fast
        await page.wait_for_timeout(500)
        assert await page.evaluate('peak')>.005,'No audible signal was captured'
        await cdp.send('Page.stopScreencast')
        video=b64decode(await page.evaluate('finish()'))
        assert b'V_VP8' in video and b'A_OPUS' in video
        movie.write_bytes(video)
        # A reload restores Fast. OS Reduce wins live, without changing the saved selection.
        await page.reload()
        await expect(page.locator('html')).to_have_attribute('data-motion','fast')
        await page.set_viewport_size({'width':390,'height':844})
        await page.emulate_media(reduced_motion='reduce')
        await expect(page.locator('html')).to_have_attribute('data-motion','reduced')
        await page.click('#prefsBtn')
        await expect(page.locator('[name=motionPace][value=fast]')).to_be_checked()
        await expect(page.locator('#motionStatus')).to_contain_text('system requests reduced motion')
        await page.click('#close')
        # Same seed without motion or sound: actions and final, settled information are identical.
        await page.click('#soundBtn');await page.click('#setupBtn');await page.click('#passPlay')
        await button('Roll dice').click()
        await expect(page.locator('#stageTitle')).to_have_text('Copper Yard')
        await expect(page.locator('.sailing, .waveRing')).to_have_count(0)
        assert await page.locator('.die').count()==2
        await expect(button('Buy · $140')).to_be_visible()
        await expect(page.locator('#mobileLadder')).to_be_hidden()
        await page.screenshot(path=out/'motion-phone.png')
        # A pinned strip must cover the scroller's top edge, not leave a slit for a row of text.
        await page.locator('#boardView').evaluate('el=>el.scrollTop=300')
        pinned=await page.evaluate('''() => {
          const v=document.getElementById('boardView'),b=v.getBoundingClientRect(),s=document.getElementById('stage');
          return s.contains(document.elementFromPoint(b.x+b.width/2,b.top+v.clientTop+1))
        }''')
        assert pinned,'Board content leaks above the pinned result'
        await button('Rent & build costs').click()
        await expect(page.locator('dialog .curve tbody tr')).to_have_count(5)
        await page.click('#close')
        await button('Buy · $140').click()
        await expect(page.locator('#stageDetail')).to_have_text('Seat 1 paid $140 · Rent $35')
        await expect(page.locator('#stageLedger em')).to_have_text('−$140')
        await page.emulate_media(reduced_motion='no-preference')
        await expect(page.locator('html')).to_have_attribute('data-motion','fast')
        await page.click('#prefsBtn');await page.check('[name=motionPace][value=reduced]')
        await page.reload()
        await expect(page.locator('html')).to_have_attribute('data-motion','reduced')
        await button('Roll dice').click()
        assert not await page.locator('#wake > *').count()
        await expect(page.locator('#stageTitle')).to_have_text('Copper Yard')
        # A human can replace a Standard voyage immediately; no stale landing or scheduled wake.
        await page.click('#prefsBtn');await page.check('[name=motionPace][value=standard]');await page.click('#close')
        await page.click('#setupBtn');await page.click('#passPlay');await button('Roll dice').click()
        await expect(ship).to_have_count(1)
        await button('Buy · $140').click()
        await expect(ship).to_have_count(0)
        await page.wait_for_timeout(2600)
        await expect(page.locator('#stage')).to_have_attribute('data-kind','buy')
        assert not await page.locator('#wake > *').count()
        assert not errors,errors
        print(json.dumps({'standard':standard,'fast':fast,'fastPersisted':True,'systemOverride':True,
                          'reducedPersisted':True,'rapidInput':True,'audioTrack':'Opus','videoTrack':'VP8'}))
        await browser.close()

if __name__=='__main__': asyncio.run(main())
