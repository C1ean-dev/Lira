type SpeechOptions = { isDeafened: boolean; outputVolume: number }
type UtteranceLike = { lang: string; volume: number }
type SpeechOutput<T extends UtteranceLike> = { speak(utterance: T): void }

export function speakPetReply<T extends UtteranceLike>(text: string, options: SpeechOptions, speech: SpeechOutput<T>, Utterance: new (text: string) => T): void {
  if (options.isDeafened || !text.trim()) return
  try {
    const utterance = new Utterance(text.slice(0, 2000))
    utterance.lang = 'pt-BR'
    utterance.volume = Math.max(0, Math.min(1, options.outputVolume / 100))
    if (utterance.volume > 0) speech.speak(utterance)
  } catch { /* The text reply still appears if speech is unavailable. */ }
}
