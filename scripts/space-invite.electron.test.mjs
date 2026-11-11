import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

test('space invitation links reach the real app through Electron startup and a second launch', {
  skip: process.env.LIRA_RUN_INVITE_TESTS !== '1', timeout: 90000,
}, async t => {
  const { build } = await import('esbuild')
  const { _electron } = await import('playwright')
  const { buildTestPanelCss } = await import('./build-test-panel-css.mjs')
  const require = createRequire(import.meta.url)
  const root = process.cwd()
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-invite-test-'))
  const entry = path.join(temporary, 'main.cjs')
  const complete = 'LIRA-ALL:' + Buffer.from(JSON.stringify({ version: 1, room: 'STARTUP', signaling: 'render' })).toString('base64url')
  const link = invite => 'lira://join?invite=' + encodeURIComponent(invite)
  const mocks = {
    PeerManager: `import { useGameStore } from '${root.replaceAll('\\', '/')}/src/store/useGameStore';
      const manager = { broadcast(){}, getPeerId: () => 'local', scheduleSignalingReconnect(){},
        disconnect(){ window.inviteEvents.push(['disconnect']); useGameStore.setState({isConnected:false, roomId:null}); },
        async joinRoom(room, player){ window.inviteEvents.push(['join', room, player.name]);
          if(room === 'FAIL') throw new Error('Espaço indisponível. Peça um novo convite.');
          useGameStore.setState({isConnected:true, roomId:room}); },
        async joinAllInvite(invite, player){ window.inviteEvents.push(['all', invite.room, invite.signaling]); await this.joinRoom(invite.room, player); },
        async prepareDirectJoin(code, player){ window.inviteEvents.push(['direct',code,player.name]);
          return {answer:'LIRA-DIRECT:answer', connected: new Promise(()=>{})}; }
      };
      export const PeerManager = {getInstance:()=>manager};
      export const createPeerInstance = () => ({on(){return this},destroy(){}});
      export const SIGNALING_TIERS = ['render','public','local']; export const RENDER_SIGNALING_HOST = 'local.test';
      export const getActiveSignalingTier = () => 'render'; export const getPreferredSignalingTier = () => 'render';
      export const setActiveSignalingTier = () => {}; export const markSignalingTierFailed = () => {}; export const shouldPreferLocalSignaling = () => false;`,
    MediaManager: `export const MediaManager = {getInstance:()=>({startMedia:async()=>{}, stopAllMedia(){}})};`,
    publicRoomsService: `export const PublicRoomsService = {getInstance:()=>({subscribe:()=>()=>{}, getRooms:()=>[], refresh(){}})};`,
    friendsPresenceService: `export const FriendsPresenceService = {getInstance:()=>({subscribe:()=>()=>{},getFriendStatus:()=>null,connectFriendsNetwork(){},broadcastPresence(){}})};`,
    idleManager: `export const idleManager = {start(){},stop(){}};`,
    updateScheduler: `export const startAutoUpdateChecks = () => () => {};`,
    callNotificationService: `export const callNotificationService = {init(){},clearNotification(){}};`,
    SpaceShell: `import React from 'react';
      import { useGameStore } from '${root.replaceAll('\\', '/')}/src/store/useGameStore';
      export function SpaceShell(){const room=useGameStore(s=>s.roomId); return React.createElement('main',{'data-testid':'space'},room);}`,
  }
  let electronApp
  const children = []
  try {
    await Promise.all([
      build({ stdin: { resolveDir: root, contents: `
        import {app,BrowserWindow,ipcMain} from 'electron';
        import {setupSpaceInviteHandling} from './electron/spaceInviteInbox';
        import {setupSingleInstanceLock} from './electron/singleInstance';
        app.setPath('userData', ${JSON.stringify(path.join(temporary, 'profile'))});
        let window = null;
        ipcMain.on('get-signaling-port-sync',event=>{event.returnValue=9000;});
        setupSpaceInviteHandling(app,ipcMain,()=>window,process.argv);
        if(!setupSingleInstanceLock({requestLock:()=>app.requestSingleInstanceLock(),quit:()=>app.exit(0),
          onSecondInstance:cb=>app.on('second-instance',cb),getWindows:()=>window?[window]:[]})) app.exit(0);
        app.whenReady().then(()=>{
          window = new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(temporary, 'preload.cjs'))},contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
          window.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))});
        });
        app.on('window-all-closed',()=>app.quit());
      ` }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' }),
      build({ entryPoints: ['electron/preload.ts'], outfile: path.join(temporary, 'preload.cjs'), bundle: true,
        platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' }),
      build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom'; import App from './src/App';
        import {useGameStore} from './src/store/useGameStore';
        import {useRoomJoinStore} from './src/store/useRoomJoinStore';
        import {useSavedSpacesStore} from './src/store/useSavedSpacesStore';
        import {linkifyText} from './src/utils/chatLinks';
        window.inviteEvents = []; useGameStore.setState({friends:[],localPlayer:{...useGameStore.getState().localPlayer,name:'Visitante'}});
        useRoomJoinStore.subscribe(state=>{if(state.pendingRoomCode) window.inviteEvents.push(['request',state.pendingRoomCode]);});
        useSavedSpacesStore.setState({savedSpaces:[]});
        const root = createRoot(document.getElementById('root')); let generation=0;
        window.inviteTesting = {
          reset(name){useRoomJoinStore.getState().clear();useGameStore.setState({roomId:null,isConnected:false,localPlayer:{...useGameStore.getState().localPlayer,name}});
            window.inviteEvents=[]; flushSync(()=>root.render(<React.StrictMode key={++generation}><App /></React.StrictMode>));},
          request(value){useRoomJoinStore.getState().requestJoin(value)},
          pending(){return useRoomJoinStore.getState().pendingRoomCode},
          chat(value){createRoot(document.getElementById('chat')).render(<>{linkifyText(value)}</>)},
        };
        root.render(<React.StrictMode key={generation}><App /></React.StrictMode>);
      ` }, outfile: path.join(temporary, 'app.js'), bundle: true, platform: 'browser', format: 'iife', logLevel: 'silent',
        define: { __APP_VERSION__: '"1.1.117"', 'process.env.NODE_ENV': '"production"',
          'import.meta.env': '{"DEV":false,"PROD":true,"BASE_URL":"/","MODE":"test"}' },
        plugins: [{ name: 'invite-boundaries', setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path: source }) => {
            const name = source.split('/').at(-1)
            if (name in mocks) return { path: name, namespace: 'invite-test' }
            if (source.startsWith('virtual:')) return { path: 'empty', namespace: 'invite-test' }
          })
          builder.onLoad({ filter: /.*/, namespace: 'invite-test' }, args => ({ contents: mocks[args.path] || 'export default false;', resolveDir: root }))
        } }],
      }),
      buildTestPanelCss(path.join(temporary, 'app.css'), ['./src/**/*.{ts,tsx}']),
    ])
    await fs.mkdir(path.join(temporary, 'profile'))
    await fs.writeFile(path.join(temporary, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><div id="chat"></div><script>window.testErrors=[];addEventListener("error",e=>window.testErrors.push(e.message));addEventListener("unhandledrejection",e=>window.testErrors.push(String(e.reason)));</script><script src="app.js"></script></body></html>')
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    electronApp = await _electron.launch({ executablePath: require('electron'), args: [entry, '--', link(complete)], env, timeout: 15000 })
    const page = await electronApp.firstWindow()
    page.setDefaultTimeout(7000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const space = page.getByTestId('space')
    try { await space.filter({ hasText: 'STARTUP' }).waitFor() }
    catch (error) {
      throw new Error('Startup invitation failed: ' + JSON.stringify(await page.evaluate(() => ({
        errors: window.testErrors, events: window.inviteEvents,
        body: document.body.innerText.slice(0, 1500), api: typeof window.electronAPI?.onSpaceInvite,
      }))), { cause: error })
    }
    await t.test('closed app consumes the full startup invite once and enters the room', async () => {
      await space.filter({ hasText: 'STARTUP' }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.inviteEvents.filter(event => event[0] === 'all')), [['all', 'STARTUP', 'render']])
    })
    async function secondLaunch(invite) {
      const child = spawn(require('electron'), [entry, '--', link(invite)], { env, windowsHide: true, stdio: 'ignore' })
      children.push(child)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Second launch timed out')) }, 10000)
        child.once('close', () => { clearTimeout(timeout); resolve() })
        child.once('error', error => { clearTimeout(timeout); reject(error) })
      })
    }
    await t.test('second launch restores a hidden app and switches rooms', async () => {
      await secondLaunch('SECOND')
      await space.filter({ hasText: 'SECOND' }).waitFor()
      assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true)
      assert.equal(await page.evaluate(() => window.inviteEvents.filter(event => event[0] === 'disconnect').length), 1)
    })
    await t.test('opening the same space again preserves the active session', async () => {
      await secondLaunch('SECOND')
      await page.waitForFunction(() => window.inviteEvents.filter(event => event[0] === 'request' && event[1] === 'SECOND').length === 2
        && window.inviteTesting.pending() === null)
      assert.equal(await page.evaluate(() => window.inviteEvents.filter(event => event[0] === 'join').length), 2)
      assert.equal(await page.evaluate(() => window.inviteEvents.filter(event => event[0] === 'disconnect').length), 1)
    })
    await t.test('missing nickname preserves the invite for entry after typing a name', async () => {
      await page.evaluate(() => window.inviteTesting.reset(''))
      await secondLaunch(complete)
      await page.getByRole('alert').filter({ hasText: 'nickname' }).waitFor()
      assert.equal(await page.getByPlaceholder('Cole o código, convite ou link').inputValue(), complete)
      await page.getByLabel('Seu Nickname').fill('Pessoa nova')
      await page.getByRole('button', { name: 'Entrar na sala', exact: true }).click()
      await space.filter({ hasText: 'STARTUP' }).waitFor()
    })
    await t.test('pasting a link and clicking a chat link both use the existing join flow', async () => {
      await page.evaluate(() => window.inviteTesting.reset('Visitante'))
      await page.getByPlaceholder('Cole o código, convite ou link').fill('https://lira-signaling.onrender.com/join#invite=PASTED')
      await page.getByRole('button', { name: 'Entrar na sala', exact: true }).click()
      await space.filter({ hasText: 'PASTED' }).waitFor()
      await page.evaluate(value => window.inviteTesting.chat(value), 'https://lira-signaling.onrender.com/join#invite=CHAT')
      await page.locator('#chat a').click()
      await space.filter({ hasText: 'CHAT' }).waitFor()
    })
    await t.test('failed entry leaves the invitation available for retry', async () => {
      await secondLaunch('FAIL')
      await page.getByRole('alert').filter({ hasText: 'Espaço indisponível' }).waitFor()
      assert.equal(await page.getByPlaceholder('Cole o código, convite ou link').inputValue(), 'FAIL')
    })
    await t.test('a direct invitation uses the nickname entered in the lobby', async () => {
      await page.evaluate(() => window.inviteTesting.reset(''))
      const offer = 'LIRA-DIRECT:' + Buffer.from(JSON.stringify({ version: 1, kind: 'offer', session: 'session-test', room: 'DIRECT',
        host: 'lira-DIRECT-host', guest: 'lira-DIRECT-peer-test', expiresAt: Date.now() + 600000,
        description: { type: 'offer', sdp: 'v=0\r\n' } })).toString('base64url')
      await secondLaunch(offer)
      await page.waitForFunction(() => window.inviteTesting.pending() === null)
      await page.getByLabel('Seu Nickname').fill('Pessoa direta')
      await page.waitForFunction(() => window.inviteEvents.some(event => event[0] === 'direct'))
      assert.deepEqual(await page.evaluate(() => window.inviteEvents.filter(event => event[0] === 'direct')), [['direct', offer, 'Pessoa direta']])
    })
    assert.deepEqual(errors, [])
  } finally {
    await electronApp?.close()
    for (const child of children) if (child.exitCode === null) child.kill()
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temporary).startsWith('lira-invite-test-'))
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
