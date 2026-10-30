import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { workerBackendOverride } from './worker-experiment.mjs'

const directory = path.resolve('.scratch/audio-improvements')
await fs.mkdir(directory, { recursive: true })
const revision = '01c4ce0e2ccf81c0d15b6ace1994c1b2e8a6c126'
const files = ['src/media/RnnoiseProcessor.ts', 'src/media/deepFilterAssets.ts', 'src/media/deepFilterWorkletSrc.js', 'src/services/DynamicBufferManager.ts', 'src/media/DeepFilterProcessor.ts']
const baseline = Object.fromEntries(files.map(file => [file, execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' }).replaceAll('\r\n', '\n')]))
const replace = (text, before, after) => {
  if (text.split(before).length !== 2) throw new Error('Experiment seam changed: ' + before)
  return text.replace(before, after)
}
const rn = baseline[files[0]]
const interactive = replace(rn, "latencyHint: this.backend ? 'interactive' : 0.02", "latencyHint: 'interactive'")
const openGate = replace(rn, '      const now = this.audioCtx.currentTime\n\n      if (shouldOpen)', `      if (this.backend && this.sensitivityMode === 'auto') shouldOpen = true
      const now = this.audioCtx.currentTime

      if (shouldOpen)`)
const combined = replace(interactive, '      const now = this.audioCtx.currentTime\n\n      if (shouldOpen)', `      if (this.backend && this.sensitivityMode === 'auto') shouldOpen = true
      const now = this.audioCtx.currentTime

      if (shouldOpen)`)
let buffer = baseline[files[3]]
buffer = replace(buffer, 'interface TrackStatsSnapshot {', `interface TrackStatsSnapshot {
  concealedSamples: number
  silentConcealedSamples: number
  totalSamplesReceived: number
  packetsDiscarded: number`)
buffer = replace(buffer, '    let hasAudio = false', '    let protectAudioRecovery = false\n    let hasAudio = false')
buffer = replace(buffer, '          let lossRatio = 0', `          const concealedSamples = Number((report as any).concealedSamples) || 0
          const silentConcealedSamples = Number((report as any).silentConcealedSamples) || 0
          const totalSamplesReceived = Number((report as any).totalSamplesReceived) || 0
          const packetsDiscarded = Number((report as any).packetsDiscarded) || 0
          if (kind === 'audio' && prev) {
            const samples = Math.max(0, totalSamplesReceived - prev.totalSamplesReceived)
            const concealed = Math.max(0, concealedSamples - prev.concealedSamples - (silentConcealedSamples - prev.silentConcealedSamples))
            if ((samples > 0 && concealed / samples > 0.01) || packetsDiscarded > prev.packetsDiscarded) protectAudioRecovery = true
          }
          let lossRatio = 0`)
buffer = replace(buffer, '          this.lastStats.set(key, {', '          this.lastStats.set(key, { concealedSamples, silentConcealedSamples, totalSamplesReceived, packetsDiscarded,')
buffer = replace(buffer, "this.adaptBuffer('audio', maxJitterAudioMs, maxLossRatioAudio, 0, 0, 0)", "this.adaptBuffer('audio', maxJitterAudioMs, maxLossRatioAudio, 0, 0, 0, protectAudioRecovery)")
buffer = replace(buffer, '    height: number\n  ) {', '    height: number,\n    protectRecovery = false\n  ) {')
buffer = replace(buffer, '    if (clampedTarget > buf.currentMs) {', `    if (isAudio && protectRecovery && clampedTarget <= buf.currentMs) {
      buf.cleanSamples = 0
      return
    }
    if (clampedTarget > buf.currentMs) {`)
const experiments = {
  motors: { baseline, candidate: { ...baseline, [files[0]]: combined } },
  worker: { baseline, candidate: { ...baseline, [files[1]]: workerBackendOverride(baseline[files[1]]) } },
  buffer: { baseline, candidate: { ...baseline, [files[3]]: buffer } },
  production: { baseline, candidate: Object.fromEntries(await Promise.all(
    [...files, 'src/media/deepFilterWorkerSrc.js', 'src/media/deepFilterWorkerBridgeSrc.js'].map(async file => [file, await fs.readFile(file, 'utf8')])
  )) },
}
for (const [name, snapshots] of Object.entries(experiments)) await fs.writeFile(path.join(directory, name + '.json'), JSON.stringify(snapshots))
await fs.writeFile(path.join(directory, 'buffer-candidate.ts'), buffer)
await fs.writeFile(path.join(directory, 'interactive-candidate.ts'), interactive)
await fs.writeFile(path.join(directory, 'gate-candidate.ts'), openGate)
await fs.writeFile(path.join(directory, 'baseline.json'), JSON.stringify(baseline))
console.log(JSON.stringify({ directory, revision, baselineSha256: createHash('sha256').update(JSON.stringify(baseline)).digest('hex') }))
