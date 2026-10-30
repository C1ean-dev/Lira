// Direct MessageChannel prototype: no SharedArrayBuffer or page-wide headers.
export function portWorkerSources() {
  const worker = `
  let handle=0;
  onmessage=({data})=>{
    const port=data.port;
    try {
      initSync({module:data.wasmModule}); handle=df_create_default(35);
      if(!handle || df_get_frame_length(handle)!==480)throw Error('Worker model initialization failed');
      port.onmessage=({data:frame})=>{
        if(frame.type==='destroy'){wasm.df_free(handle);handle=0;port.close();close();return;}
        try {
          const clean=df_process_frame(handle,frame.input), output=new Float32Array(clean.length);
          for(let i=0;i<clean.length;i++){if(!Number.isFinite(clean[i]))throw Error('Non-finite worker audio');output[i]=Math.max(-1,Math.min(1,clean[i]));}
          port.postMessage({type:'frame',input:frame.input,output},[frame.input.buffer,output.buffer]);
        }catch(error){port.postMessage({type:'error',message:String(error)});}
      };
      port.start();postMessage({ready:true});
    }catch(error){if(handle)wasm.df_free(handle);port.close();postMessage({error:String(error)});close();}
  };`
  const worklet = `class PortWorkerBridge extends AudioWorkletProcessor {
    constructor(){super();this.dead=false;this.bypass=false;this.pool=Array.from({length:8},()=>new Float32Array(480));this.frame=this.pool.pop();this.filled=0;this.output=new Float32Array(8192);this.read=0;this.write=1920;this.available=1920;
      this.port.onmessage=({data})=>{
        if(data.type==='destroy'){this.dead=true;this.worker?.postMessage({type:'destroy'});this.worker?.close();}
        else if(data.type==='bypass')this.bypass=data.enabled;
        else if(data.type==='bind'){
          this.worker=data.port;
          this.worker.onmessage=({data:frame})=>{
            if(frame.type==='error'){this.fail(frame.message);return;}
            if(frame.type!=='frame'||frame.output.length!==480||this.available+480>this.output.length){this.fail('Worker frame overflow');return;}
            this.pool.push(frame.input);
            for(let i=0;i<480;i++){this.output[this.write]=frame.output[i];this.write=(this.write+1)&8191;}
            this.available+=480;
          };this.worker.start();this.port.postMessage({type:'ready'});
        }
      };
    }
    fail(message){if(this.dead)return;this.dead=true;this.worker?.postMessage({type:'destroy'});this.port.postMessage({type:'error',message});}
    process(inputs,outputs){
      const input=inputs[0]?.[0],output=outputs[0]?.[0];if(!output)return !this.dead;output.fill(0);if(this.dead)return false;if(!input||!this.worker)return true;
      for(let i=0;i<input.length;i++){
        this.frame[this.filled++]=input[i];
        if(this.filled===480){this.worker.postMessage({type:'frame',input:this.frame},[this.frame.buffer]);this.frame=this.pool.pop();this.filled=0;if(!this.frame){this.fail('Worker input backlog');return true;}}
      }
      if(this.available<output.length){this.fail('Worker output underrun');return true;}
      for(let i=0;i<output.length;i++){output[i]=this.bypass?input[i]:this.output[this.read];this.read=(this.read+1)&8191;}
      this.available-=output.length;return true;
    }
  };registerProcessor('__NAME__',PortWorkerBridge);`
  return { worker, worklet }
}

export function portWorkerBackendOverride(source) {
  const { worker, worklet } = portWorkerSources()
  const marker = 'export async function buildDeepFilterModule(name: string) {'
  return source.slice(0, source.indexOf(marker)) + `
  export async function buildDeepFilterModule(name: string) {
    const wasmModule=await loadDeepFilterModule(), marker=upstreamWorklet.indexOf('  // src/worklet.ts');
    const glue=upstreamWorklet.slice(0,marker).replace('  // pkg/df.js',workletCompat+'\\n  // pkg/df.js');
    const url=URL.createObjectURL(new Blob([glue,${JSON.stringify(worker)},'\\n})();'],{type:'text/javascript'}));
    const worker=new Worker(url), channel=new MessageChannel();
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker startup timeout'));},8000);worker.onmessage=({data})=>{clearTimeout(timer);data.ready?resolve():reject(Error(data.error));};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage({wasmModule,port:channel.port1},[channel.port1]);}).finally(()=>URL.revokeObjectURL(url));
    return {blobUrl:URL.createObjectURL(new Blob([${JSON.stringify(worklet)}.replace('__NAME__',name)],{type:'text/javascript'})),procName:name,debug:'experimental direct-port worker',processorOptions:{},
      connect(node:AudioWorkletNode){node.port.postMessage({type:'bind',port:channel.port2},[channel.port2]);},dispose(){worker.terminate();}};
  }`
}
