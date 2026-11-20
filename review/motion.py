"""Record Chromium's actual surface and the game's own sound bus, without OS screen/mic access."""
import asyncio
from base64 import b64decode
from pathlib import Path
from playwright.async_api import async_playwright, expect

root=Path(__file__).resolve().parent
game=(root.parent/'dist/index.html').read_text()
tap='''window.tap=audio.createMediaStreamDestination();bus.connect(tap);
window.meter=audio.createAnalyser();bus.connect(meter);'''
assert game.count('bus.connect(audio.destination);')==1

async def main():
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path='/usr/bin/google-chrome')
        page=await browser.new_page(viewport={'width':1280,'height':900})
        await page.route('http://motion.test/',lambda r:r.fulfill(content_type='text/html',body=game.replace('bus.connect(audio.destination);','bus.connect(audio.destination);'+tap)))
        await page.add_init_script('crypto.getRandomValues=a=>(a[0]=1,a)')
        await page.goto('http://motion.test/')
        await page.click('#setupBtn');await page.click('#passPlay')
        await page.evaluate('''() => {
          const c=document.createElement('canvas');c.width=1280;c.height=900;
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
        await button('Roll dice').click()
        ship=page.locator('.sailing')
        await expect(ship).to_be_visible(timeout=500)
        start=await ship.bounding_box();await page.wait_for_timeout(230);travel=await ship.bounding_box()
        assert travel and max(abs(start[d]-travel[d]) for d in ('x','y'))>20
        await page.screenshot(path=root/'motion-roll.png')
        await page.wait_for_timeout(650)
        await button('Start auction').click();await page.wait_for_timeout(950)
        await button('Bid $10').click();await page.wait_for_timeout(1000)
        await button('Withdraw').click();await page.wait_for_timeout(235)
        await expect(page.locator('#stageTitle')).to_have_text('Sold · $10')
        await page.screenshot(path=root/'motion-sale.png')
        await page.wait_for_timeout(1300)
        assert await page.evaluate('peak')>.005,'No audible signal was captured'
        await cdp.send('Page.stopScreencast')
        video=b64decode(await page.evaluate('finish()'))
        assert b'V_VP8' in video and b'A_OPUS' in video
        (root.parent/'docs/table-in-motion.webm').write_bytes(video)
        # Replay the same starting turn without motion or sound. The result still reads the same.
        await page.set_viewport_size({'width':390,'height':844})
        await page.emulate_media(reduced_motion='reduce')
        await page.click('#soundBtn');await page.click('#setupBtn');await page.click('#passPlay')
        await button('Roll dice').click()
        await expect(page.locator('#stageTitle')).to_have_text('Copper Yard')
        await expect(page.locator('.sailing, .waveRing')).to_have_count(0)
        assert await page.locator('.die').count()==2
        await expect(button('Buy · $140')).to_be_visible()
        await page.screenshot(path=root/'motion-phone.png')
        await button('Rent & build costs').click()
        await expect(page.locator('dialog .curve tbody tr')).to_have_count(5)
        await page.click('#close')
        await button('Buy · $140').click()
        await expect(page.locator('#stageDetail')).to_have_text('Seat 1 paid $140 · Rent $35')
        await expect(page.locator('#stageLedger em')).to_have_text('−$140')
        await browser.close()

if __name__=='__main__': asyncio.run(main())
