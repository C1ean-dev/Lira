import { createContext, useContext } from 'react'
import type { useCallTranscription } from './useCallTranscription'

export type SpaceTranscription = ReturnType<typeof useCallTranscription> & {
  canStart: boolean
  zoneName: string
}

// History can also open in the lobby, where no live transcription session exists.
export const SpaceTranscriptionContext = createContext<SpaceTranscription | null>(null)
export const useSpaceTranscription = () => useContext(SpaceTranscriptionContext)
