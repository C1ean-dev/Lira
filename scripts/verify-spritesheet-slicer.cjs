// Exercise the real slicer in Chromium without opening or writing a user profile.
const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(root, 'node_modules/.cache/slicer-check-'))
app.setPath('userData', path.join(directory, 'profile'))
app.disableHardwareAcceleration()
const timeout = setTimeout(() => app.exit(1), 60000)

app.whenReady().then(async () => {
  const component = path.join(root, 'src/components/avatar-customizer/AvatarSpritesheetSlicerModal.tsx')
  await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { AvatarSpritesheetSlicerModal } from ${JSON.stringify(component)};
      import { buildAtlas, readAtlas, loadAtlasImage } from ${JSON.stringify(path.join(root, 'src/assets/atlasService.ts'))};
      import { parseSparrowAtlasAndSlice } from ${JSON.stringify(path.join(root, 'src/engine/avatar/avatarAtlasImporter.ts'))};
      window.roundtripAsset=async asset=>{
        const pair=await buildAtlas([asset]); window.savedPair=pair;
        return (await readAtlas(pair)).assets[0];
      };
      window.importCombinedXml=async (xml,sheets)=>{
        const canvas=document.createElement('canvas');canvas.width=Math.max(...sheets.map(s=>s.width));canvas.height=sheets.reduce((n,s)=>n+s.height,0);
        const ctx=canvas.getContext('2d');let y=0;
        for(const sheet of sheets){ctx.drawImage(await loadAtlasImage(sheet.src),0,y);y+=sheet.height}
        return parseSparrowAtlasAndSlice(xml,canvas,'other');
      };
      const root=createRoot(document.getElementById('root')); let revision=0;
      window.renderSlicer=(width,height,selection,override)=>{
        const source = document.createElement('canvas'); source.width=width; source.height=height;
        const ctx=source.getContext('2d');
        for(let x=0;x<width;x+=selection.w){ctx.fillStyle='hsl('+x/selection.w*40+' 70% 50%)';ctx.fillRect(x,0,selection.w,height)}
        const image=source.toDataURL();
        const frame=document.createElement('canvas');frame.width=selection.w;frame.height=selection.h;
        frame.getContext('2d').drawImage(source,selection.x,selection.y,selection.w,selection.h,0,0,selection.w,selection.h);
        const preset={id:'test',name:'Teste',directions:{down:[{...selection,dataUrl:frame.toDataURL()}],up:[],left:[],right:[]}};
        const asset=override||{id:'test',name:'Teste',type:'avatar',category:'Geral',avatarSlot:'other',isObstacle:false,createdAt:1,width:4,height:6,frames:[frame.toDataURL()],slicerPresets:[preset]};
        window.testAsset=asset;
        root.render(<AvatarSpritesheetSlicerModal key={++revision} isOpen onClose={()=>{}} onSaveComplete={(assets,xml)=>window.savedXml=xml} imageSrc={asset.sourceImageSrc||image} category="other" editingAsset={asset}/>);
      };
      window.renderSlicer(1152,2048,{x:128,y:192,w:128,h:192});
    `, resolveDir: root, loader: 'tsx' },
    bundle: true, outfile: path.join(directory, 'ui.js'), platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'isolated-stores', setup(build) {
      build.onResolve({ filter: /\/(useCustomAssetsStore|useGameStore|AvatarPixelArtModal)$/ }, args => ({ path: args.path, namespace: 'test-stub' }))
      build.onLoad({ filter: /.*/, namespace: 'test-stub' }, args => ({ contents: args.path.endsWith('AvatarPixelArtModal')
        ? 'export const AvatarPixelArtModal=()=>null'
        : args.path.endsWith('useCustomAssetsStore')
          ? `export const useCustomAssetsStore={getState:()=>({customAssets:window.savedAsset?[window.savedAsset]:[],categories:[],updateCustomAsset:async(id,change)=>{window.savedAsset=await window.roundtripAsset({...window.testAsset,...change})}})}`
          : `export const useGameStore={getState:()=>({localPlayer:{avatar:{}},setLocalPlayer:()=>{}})}` }))
    }}],
  })
  execFileSync(process.execPath, [path.join(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', path.join(root, 'src/index.css'), '-o', path.join(directory, 'ui.css'), '--content', component], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' })
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>')
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { backgroundThrottling: false, offscreen: true } })
  await window.loadFile(path.join(directory, 'index.html'))
  const result = await window.webContents.executeJavaScript(`(async () => {
    const wait=()=>new Promise(r=>setTimeout(r,100));
    for(let i=0;i<50&&!document.querySelector('canvas')?.width;i++) await wait();
    await wait();
    const failures=[];
    const check=(ok,message)=>{if(!ok)failures.push(message)};
    const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
    const canvas=document.querySelector('canvas');
    const rect=canvas.getBoundingClientRect(), parent=canvas.parentElement.getBoundingClientRect();
    check(Math.abs(rect.width/rect.height-1152/2048)<0.001,'Canvas proportions changed');
    check(rect.width<=parent.width+2&&rect.height<=parent.height+2,'Canvas clipped by its own wrapper');
    const stage=canvas.closest('[data-spritesheet-stage]');
    check(stage&&rect.left>=stage.getBoundingClientRect().left&&rect.right<=stage.getBoundingClientRect().right&&rect.top>=stage.getBoundingClientRect().top&&rect.bottom<=stage.getBoundingClientRect().bottom,'Full spritesheet must fit on opening');
    check(!button('1×1')&&!button('8×8')&&!button('64px'),'Fixed size presets remain');
    window.slicerCheckFailures=failures;
    return {ok:!failures.length,failures};
  })()`)
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.join(directory, 'tall.png'), (await window.webContents.capturePage()).toPNG())
  const cases = await window.webContents.executeJavaScript(`(async () => {
    const failures=window.slicerCheckFailures, results=[];
    const wait=()=>new Promise(r=>setTimeout(r,100));
    const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
    const check=(ok,message)=>{if(!ok)failures.push(message)};
    const fixtures=[
      [1152,2048,{x:128,y:192,w:128,h:192},8],
      [4096,384,{x:256,y:128,w:192,h:128},20],
      [1100,512,{x:128,y:192,w:128,h:192},7],
      [1152,512,{x:1024,y:0,w:128,h:192},1],
      [64,64,{x:8,y:8,w:8,h:8},7],
    ];
    for(const [width,height,selection,count] of fixtures){
      window.renderSlicer(width,height,selection); await wait(); await wait();
      const canvas=document.querySelector('canvas'), stage=canvas.closest('[data-spritesheet-stage]');
      const rect=canvas.getBoundingClientRect(), bounds=stage.getBoundingClientRect();
      check(rect.left>=bounds.left&&rect.right<=bounds.right&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom,'Sheet must fit: '+width+'x'+height);
      const sequential=button('Frames Sequenciais');
      check(sequential?.textContent.includes(count+' Frames Sequenciais'),'Wrong sequence count: '+width);
      sequential?.click(); await wait();
      button('Ver XML Gerado').click(); await wait();
      const xmlNode=[...document.querySelectorAll('pre')].find(n=>n.textContent.includes('<TextureAtlas'));
      const xml=new DOMParser().parseFromString(xmlNode?.textContent||'', 'application/xml');
      const frames=[...xml.querySelectorAll('SubTexture')];
      check(frames.length===count+1,'Wrong total frames: '+width);
      const positions=frames.slice(1).map(n=>['x','y','width','height'].map(k=>Number(n.getAttribute(k))));
      check(JSON.stringify(positions)===JSON.stringify(Array.from({length:count},(_,i)=>[selection.x+i*selection.w,selection.y,selection.w,selection.h])),'Wrong sequence positions or dimensions: '+width);
      results.push({width,height,frames:positions.length});
    }
    window.renderSlicer(4096,384,{x:256,y:128,w:192,h:128}); await wait(); await wait();
    for(let i=0;i<12;i++) document.querySelector('[title="Aumentar Zoom"]').click();
    await wait();
    const viewport=document.querySelector('[data-spritesheet-stage] > .overflow-auto');
    viewport.scrollTo(viewport.scrollWidth,viewport.scrollHeight); await wait();
    const rect=document.querySelector('canvas').getBoundingClientRect(), bounds=viewport.getBoundingClientRect();
    check(Math.abs(rect.width/rect.height-4096/384)<0.001,'Zoom distorts sheet proportions');
    check(rect.right<=bounds.right&&rect.right>bounds.left,'Right edge unreachable after zoom');
    check(rect.bottom<=bounds.bottom&&rect.bottom>bounds.top,'Bottom edge unreachable after zoom');
    button('Ajustar').click(); await wait();
    return {ok:!failures.length,failures,cases:results};
  })()`)
  Object.assign(result, cases)
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.join(directory, 'wide.png'), (await window.webContents.capturePage()).toPNG())
  const multiple = await window.webContents.executeJavaScript(`(async()=>{
    const failures=window.slicerCheckFailures;
    const check=(ok,message)=>{if(!ok)failures.push(message)};
    const wait=()=>new Promise(r=>setTimeout(r,100));
    const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text));
    window.renderSlicer(384,192,{x:0,y:0,w:128,h:192});await wait();await wait();
    const files=new DataTransfer();
    for(const [name,color] of [['bocejo.png','#00ffff'],['sono.png','#ff00ff']]){
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;
      const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,256,192);
      files.items.add(new File([await new Promise(r=>canvas.toBlob(r))],name,{type:'image/png'}));
    }
    const input=document.querySelector('input[type=file]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    for(let i=0;i<50&&document.querySelector('select').options.length!==3;i++)await wait();
    await wait();
    const select=document.querySelector('select');
    check(select.options.length===3,'Multiple PNG upload did not add all sheets');
    const yawnSheet=select.options[1].value,sleepSheet=select.options[2].value;
    button('Direita').click();await wait();
    button('Bocejar').click();await wait();
    check(!button('Frente')&&!button('Costas')&&!button('Esquerda')&&!button('Direita'),'Yawning must have one sequence without direction controls');
    button('Frames Sequenciais').click();await wait();
    button('Dormir').click();await wait();
    check(!button('Frente')&&!button('Costas')&&!button('Esquerda')&&!button('Direita'),'Sleeping must have one sequence without direction controls');
    select.value=sleepSheet;select.dispatchEvent(new Event('change',{bubbles:true}));await wait();await wait();
    button('Frames Sequenciais').click();await wait();
    button('Bocejar').click();await wait();
    document.querySelector('[title="Clique para posicionar a seleção neste frame"]').click();await wait();await wait();
    check(select.value===yawnSheet,'Selecting an existing frame did not switch its source sheet');
    button('Salvar Alterações').click();
    for(let i=0;i<100&&!window.savedAsset;i++)await wait();
    const saved=window.savedAsset;
    check(saved?.sourceSheets?.length===3,'Saving lost the source sheets');
    check(Array.isArray(saved?.activityAnimations?.yawn)&&saved.activityAnimations.yawn.length===2&&Array.isArray(saved?.activityAnimations?.sleep)&&saved.activityAnimations.sleep.length===2,'Activities must persist as single frame sequences');
    check(Array.isArray(saved?.slicerPresets[0].animations.yawn)&&Array.isArray(saved?.slicerPresets[0].animations.sleep),'Editor metadata must persist one sequence per activity');
    check(!/_yawn_(down|up|left|right)_|_sleep_(down|up|left|right)_/.test(window.savedXml),'Activity XML names must not contain walking directions');
    check(!window.savedPair?.xml.includes('data:image/'),'Images persisted inside XML');
    check(saved?.slicerPresets[0].directions.down.length===1,'Editing activity animations changed walking frames');
    const imported=await window.importCombinedXml(window.savedXml,saved.sourceSheets);
    check(imported.length===1&&imported[0].activityAnimations?.yawn?.length===2&&imported[0].activityAnimations?.sleep?.length===2,'Export/reimport lost activity animation grouping');
    window.renderSlicer(384,192,{x:0,y:0,w:128,h:192},saved);await wait();await wait();
    check(document.querySelector('select').options.length===3,'Reopening lost the source sheet selector');
    button('Dormir').click();await wait();
    check(!button('Frente')&&!button('Costas')&&!button('Esquerda')&&!button('Direita')&&!document.querySelector('[title="Mover para outra direção (Frente, Costas, etc.)"]'),'Reopened activity exposes direction controls');
    check(document.querySelectorAll('[alt^="Frame "]').length===2,'Reopening lost sleeping frames');
    button('Caminhar').click();await wait();
    check(!!button('Frente')&&!!button('Costas')&&!!button('Esquerda')&&!!button('Direita'),'Walking must retain all four directions');
    button('Dormir').click();await wait();
    const invalid=new DataTransfer();invalid.items.add(new File(['invalid'],'bad.png',{type:'image/png'}));
    const upload=document.querySelector('input[type=file]');upload.files=invalid.files;upload.dispatchEvent(new Event('change',{bubbles:true}));
    for(let i=0;i<50&&!document.querySelector('[role=alert]');i++)await wait();
    check(!!document.querySelector('[role=alert]')&&document.querySelector('select').options.length===3,'Invalid PNG changed the source sheets');
    return {ok:!failures.length,failures,multipleSheets:true,animationRoundtrip:true};
  })()`)
  Object.assign(result, multiple)
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  fs.writeFileSync(path.join(directory, 'multiple.png'), (await window.webContents.capturePage()).toPNG())
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  clearTimeout(timeout)
  app.exit(result.ok ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
