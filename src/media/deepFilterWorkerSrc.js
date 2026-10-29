// Injected inside the pinned libDF glue closure. Inference never runs on the
// audio rendering thread. Both endpoints exchange owned PCM buffers directly.
let model = 0
onmessage = ({ data }) => {
  const port = data.port
  const closeModel = () => {
    if (model) { wasm.df_free(model); model = 0 }
    port.close()
    close()
  }
  try {
    initSync({ module: data.wasmModule })
    model = df_create_default(35)
    if (!model || df_get_frame_length(model) !== 480) throw new Error('Invalid DeepFilterNet worker model')
    port.onmessage = ({ data: frame }) => {
      if (frame.type === 'destroy') { closeModel(); return }
      try {
        if (!(frame.input instanceof Float32Array) || frame.input.length !== 480) throw new Error('Invalid DeepFilterNet input frame')
        const enhanced = df_process_frame(model, frame.input)
        if (enhanced.length !== 480) throw new Error('Invalid DeepFilterNet output frame')
        const output = new Float32Array(480)
        for (let i = 0; i < output.length; i++) {
          if (!Number.isFinite(enhanced[i])) throw new Error('Non-finite DeepFilterNet audio')
          output[i] = Math.max(-1, Math.min(1, enhanced[i]))
        }
        port.postMessage({ type: 'frame', input: frame.input, output }, [frame.input.buffer, output.buffer])
      } catch (error) { port.postMessage({ type: 'error', message: error.message }); closeModel() }
    }
    port.start()
    postMessage({ ready: true })
  } catch (error) { postMessage({ error: error.message }); closeModel() }
}
