import { RnnoiseProcessor } from './RnnoiseProcessor'
import { buildDeepFilterModule } from './deepFilterAssets'
import { useMediaStore } from '../store/useMediaStore'

// Shared graph, gain, gate, meters and lifecycle for Electron, Capacitor and browsers.
export class DeepFilterProcessor {
  private readonly engine: RnnoiseProcessor
  constructor() {
    this.engine = new RnnoiseProcessor({
      name: 'DeepFilterNet',
      buildModule: buildDeepFilterModule,
      setStatus: (status, error) => useMediaStore.getState().setDeepFilterStatus(status, error),
      setStage: stage => useMediaStore.getState().setDeepFilterStage(stage),
    })
  }
  processStream(...args: Parameters<RnnoiseProcessor['processStream']>) { return this.engine.processStream(...args) }
  setRuntimeFailureHandler(...args: Parameters<RnnoiseProcessor['setRuntimeFailureHandler']>) { this.engine.setRuntimeFailureHandler(...args) }
  setInputVolume(value: number) { this.engine.setInputVolume(value) }
  setSensitivity(...args: Parameters<RnnoiseProcessor['setSensitivity']>) { this.engine.setSensitivity(...args) }
  setSuppressionEnabled(value: boolean) { this.engine.setSuppressionEnabled(value) }
  setTestLoopback(value: boolean) { this.engine.setTestLoopback(value) }
  updateAudioOutput(value: string) { this.engine.updateAudioOutput(value) }
  resumeContext() { return this.engine.resumeContext() }
  isReady() { return this.engine.isReady() }
  getLastError() { return this.engine.getLastError() }
  getHoldTimeMs() { return this.engine.getHoldTimeMs() }
  getCurrentThreshold() { return this.engine.getCurrentThreshold() }
  dispose() { this.engine.dispose() }
}
