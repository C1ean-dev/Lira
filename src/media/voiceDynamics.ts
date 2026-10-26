// Preserve each engine's transient control, while cancelling Web Audio's fixed
// makeup gain that otherwise raises quiet speech and background noise together.
export const VOICE_DYNAMICS = {
  classic: { thresholdDb: -24, kneeDb: 12, ratio: 4, attackSeconds: 0.005, releaseSeconds: 0.18 },
  soft: { thresholdDb: -22, kneeDb: 18, ratio: 3, attackSeconds: 0.008, releaseSeconds: 0.22 },
} as const

function makeupCompensation(config: { thresholdDb: number; kneeDb: number; ratio: number }) {
  const { thresholdDb, kneeDb, ratio } = config
  let fullScaleDb = thresholdDb * (1 - 1 / ratio)
  if (kneeDb > 0) {
    const threshold = 10 ** (thresholdDb / 20)
    const kneeEnd = 10 ** ((thresholdDb + kneeDb) / 20)
    const distance = kneeEnd - threshold
    let lower = 0.1
    let upper = 10000
    // Chromium's exponential soft knee meets the requested dB slope at its end.
    // Solve that slope once per graph, not for each audio frame.
    for (let iteration = 0; iteration < 24; iteration++) {
      const k = (lower + upper) / 2
      const curve = threshold - Math.expm1(-k * distance) / k
      const slope = kneeEnd * Math.exp(-k * distance) / curve
      if (slope > 1 / ratio) lower = k
      else upper = k
    }
    const k = (lower + upper) / 2
    const curve = threshold - Math.expm1(-k * distance) / k
    fullScaleDb = 20 * Math.log10(curve) - (thresholdDb + kneeDb) / ratio
  }
  // https://www.w3.org/TR/webaudio-1.0/#computing-the-makeup-gain
  return 10 ** (fullScaleDb * 0.6 / 20)
}

export function createVoiceDynamics(context: BaseAudioContext, mode: 'classic' | 'soft') {
  const config = VOICE_DYNAMICS[mode]
  const compressor = context.createDynamicsCompressor()
  const now = context.currentTime
  compressor.threshold.setValueAtTime(config.thresholdDb, now)
  compressor.knee.setValueAtTime(config.kneeDb, now)
  compressor.ratio.setValueAtTime(config.ratio, now)
  compressor.attack.setValueAtTime(config.attackSeconds, now)
  compressor.release.setValueAtTime(config.releaseSeconds, now)

  const output = context.createGain()
  output.gain.setValueAtTime(makeupCompensation(config), now)
  compressor.connect(output)
  return { compressor, output }
}
