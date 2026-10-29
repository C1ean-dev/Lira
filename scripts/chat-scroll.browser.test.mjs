import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'

test('chat reaches the bottom after deferred images and preserves history reading', {
  skip: process.env.LIRA_RUN_BROWSER_TESTS !== '1', timeout: 60000,
}, async () => {
  const { build } = await import('esbuild')
  const { chromium } = await import('playwright')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-chat-scroll-'))
  let browser
  let server
  const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="600"><rect width="320" height="600" fill="blue"/></svg>'
  try {
    await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { useChatPagination } from './src/hooks/useChatPagination';
      const messages = Array.from({length:24}, (_,i) => ({id:String(i)}));
      function Chat() {
        const [channel, setChannel] = useState('first');
        const [extra, setExtra] = useState(0);
        const pagination = useChatPagination(messages, channel);
        window.chatTest = {setChannel, setExtra};
        return <div id="viewport" ref={pagination.messagesRef} onScroll={pagination.onScroll}
          style={{height:280,width:320,overflowY:'auto'}}>
          <div ref={pagination.contentRef}>
            {pagination.page.messages.map(m => <div key={m.id} style={{height:35}}>Message {m.id}</div>)}
            <img src="/delayed.svg" style={{display:'block',width:'100%'}} />
            <div style={{height:extra}} />
            <div>Last message</div>
          </div>
        </div>;
      }
      function App() {
        const [open, setOpen] = useState(true);
        window.reopenChat = () => setOpen(value => !value);
        return open ? <Chat /> : null;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` }, outfile: path.join(temporary, 'chat.js'), bundle: true, format: 'esm', platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
    server = createServer(async (request, response) => {
      if (request.url === '/chat.js') {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(await fs.readFile(path.join(temporary, 'chat.js')))
      } else if (request.url === '/delayed.svg') {
        response.setHeader('Content-Type', 'image/svg+xml')
        response.end(imageSvg)
      } else response.end('<!doctype html><div id="root"></div><script type="module" src="/chat.js"></script>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let imageRoute
    const imageRequested = new Promise(resolve => { imageRoute = resolve })
    await page.route('**/delayed.svg', route => imageRoute(route), { times: 1 })
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' })
    const route = await imageRequested
    const atBottom = () => page.waitForFunction(() => {
      const node = document.getElementById('viewport')
      return node && Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 1
    }, null, { timeout: 5000 })
    await atBottom()
    await route.fulfill({ contentType: 'image/svg+xml', body: imageSvg })
    await page.waitForFunction(() => document.querySelector('img')?.naturalHeight === 600)
    await atBottom()
    await page.evaluate(() => { document.getElementById('viewport').scrollTop = 100 })
    await page.waitForFunction(() => document.getElementById('viewport').scrollTop === 100)
    // Deliver the native scroll event before changing content size.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.evaluate(() => window.chatTest.setExtra(300))
    await page.waitForFunction(() => document.querySelector('#viewport > div').scrollHeight > 1700)
    assert.equal(await page.locator('#viewport').evaluate(node => node.scrollTop), 100)
    await page.evaluate(() => { document.getElementById('viewport').scrollTop = 99999 })
    await atBottom()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.evaluate(() => { document.getElementById('viewport').style.height = '180px' })
    await atBottom()
    await page.evaluate(() => window.reopenChat())
    await page.waitForSelector('#viewport', { state: 'detached' })
    await page.evaluate(() => window.reopenChat())
    await page.waitForFunction(() => document.querySelector('img')?.naturalHeight === 600)
    await atBottom()
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    if (server) await new Promise(resolve => server.close(resolve))
    assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep))
    await fs.rm(temporary, { recursive: true, force: true })
  }
})
