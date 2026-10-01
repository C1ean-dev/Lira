/**
 * Synthesizes a subtle, pleasant notification chime using the Web Audio API.
 * No external media files or network calls needed.
 */
let audioCtx: AudioContext | null = null

export function playMessageNotificationChime() {
  try {
    if (typeof window === 'undefined') return
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) return

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass()
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume()
    }

    const now = audioCtx.currentTime

    // First note: G5 (784Hz)
    const osc1 = audioCtx.createOscillator()
    const gain1 = audioCtx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(783.99, now)
    gain1.gain.setValueAtTime(0, now)
    gain1.gain.linearRampToValueAtTime(0.08, now + 0.02)
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    osc1.connect(gain1)
    gain1.connect(audioCtx.destination)
    osc1.start(now)
    osc1.stop(now + 0.16)

    // Second note: C6 (1046.5Hz) - harmonious higher pitch
    const osc2 = audioCtx.createOscillator()
    const gain2 = audioCtx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1046.5, now + 0.08)
    gain2.gain.setValueAtTime(0, now + 0.08)
    gain2.gain.linearRampToValueAtTime(0.1, now + 0.1)
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
    osc2.connect(gain2)
    gain2.connect(audioCtx.destination)
    osc2.start(now + 0.08)
    osc2.stop(now + 0.28)
  } catch (err) {
    // Gracefully ignore audio autoplay block or unsupported environment
  }
}
