// Experimental source override only. Never loaded by the application build.
export function workerBackendOverride(source) {
  const worker = `
  let handle = 0;
  onmessage = ({data}) => {
    try {
      initSync({module:data.wasmModule}); handle=df_create_default(35);
      if(!handle || df_get_frame_length(handle)!==480) throw Error('Worker model initialization failed');
      const state=new Int32Array(data.state), input=new Float32Array(data.input), output=new Float32Array(data.output), frame=new Float32Array(480);
      postMessage({ready:true});
      while(!Atomics.load(state,4)) {
        const write=Atomics.load(state,1), read=Atomics.load(state,0);
        if(write-read<480) { Atomics.wait(state,1,write,100); continue; }
        for(let i=0;i<480;i++) frame[i]=input[(read+i)&4095];
        Atomics.store(state,0,read+480);
        const clean=df_process_frame(handle,frame), outWrite=Atomics.load(state,3), outRead=Atomics.load(state,2);
        if(outWrite-outRead+480>8192) throw Error('Worker output overrun');
        for(let i=0;i<480;i++) { if(!Number.isFinite(clean[i])) throw Error('Invalid worker audio'); output[(outWrite+i)&8191]=Math.max(-1,Math.min(1,clean[i])); }
        Atomics.store(state,3,outWrite+480);
      }
    } catch(error) { postMessage({error:String(error)}); }
    finally { if(handle) wasm.df_free(handle); close(); }
  };`
  const worklet = `class WorkerBridge extends AudioWorkletProcessor {
    constructor(options) {
      super(); this.state=new Int32Array(options.processorOptions.state); this.input=new Float32Array(options.processorOptions.input); this.output=new Float32Array(options.processorOptions.output); this.bypass=false; this.dead=false;
      this.port.onmessage=({data})=>{if(data.type==='destroy'){this.dead=true;Atomics.store(this.state,4,1);Atomics.notify(this.state,1);}else if(data.type==='bypass')this.bypass=data.enabled;};
      this.port.postMessage({type:'ready'});
    }
    process(inputs,outputs) {
      const input=inputs[0]?.[0], output=outputs[0]?.[0]; if(this.dead)return false; if(!output)return true; output.fill(0); if(!input)return true;
      const inRead=Atomics.load(this.state,0), inWrite=Atomics.load(this.state,1);
      if(inWrite-inRead+input.length>4096){this.port.postMessage({type:'error',message:'Worker input overrun'});this.dead=true;return true;}
      for(let i=0;i<input.length;i++)this.input[(inWrite+i)&4095]=input[i];
      Atomics.store(this.state,1,inWrite+input.length); Atomics.notify(this.state,1);
      const outRead=Atomics.load(this.state,2), outWrite=Atomics.load(this.state,3);
      if(outWrite-outRead<output.length){this.port.postMessage({type:'error',message:'Worker output underrun'});this.dead=true;Atomics.store(this.state,4,1);Atomics.notify(this.state,1);return true;}
      for(let i=0;i<output.length;i++)output[i]=this.bypass?input[i]:this.output[(outRead+i)&8191];
      Atomics.store(this.state,2,outRead+output.length); return true;
    }
  };registerProcessor('__NAME__',WorkerBridge);`
  const marker = 'export async function buildDeepFilterModule(name: string) {'
  if (!source.includes(marker)) throw new Error('DeepFilter loader seam changed')
  return source.slice(0, source.indexOf(marker)) + `
  export async function buildDeepFilterModule(name: string) {
    if(!crossOriginIsolated) throw new Error('Worker experiment requires cross-origin isolation');
    const wasmModule=await loadDeepFilterModule();
    const marker=upstreamWorklet.indexOf('  // src/worklet.ts');
    const glue=upstreamWorklet.slice(0,marker).replace('  // pkg/df.js', workletCompat+'\\n  // pkg/df.js');
    const workerUrl=URL.createObjectURL(new Blob([glue,${JSON.stringify(worker)},'\\n})();'],{type:'text/javascript'}));
    const state=new SharedArrayBuffer(32), input=new SharedArrayBuffer(4096*4), output=new SharedArrayBuffer(8192*4);
    new Int32Array(state)[3]=1920; // 40 ms bounded startup queue; 20 ms underruns in the first trial.
    const worker=new Worker(workerUrl);
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('Worker initialization timeout'));},10000);
      worker.onmessage=({data})=>{clearTimeout(timer);data.ready?resolve():reject(new Error(data.error));};
      worker.onerror=event=>{clearTimeout(timer);reject(new Error(event.message));};
      worker.postMessage({wasmModule,state,input,output});
    }).finally(()=>URL.revokeObjectURL(workerUrl));
    return {blobUrl:URL.createObjectURL(new Blob([${JSON.stringify(worklet)}.replace('__NAME__',name)],{type:'text/javascript'})),procName:name,debug:'experimental worker backend',processorOptions:{state,input,output}};
  }`
}
