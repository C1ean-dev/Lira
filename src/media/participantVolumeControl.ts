type Participant = { id: string; name?: string; gameId?: string; isDjBot?: boolean }
type DjVolume = { isDjModeActive: boolean; volume: number; isMuted: boolean; setVolume(value: number): void }
type ParticipantVolumes = { participantVolumes: Record<string, number>; setParticipantVolume(id: string, value: number): void }

export function participantVolumeControl(
  user: Participant,
  remote: { djOwnerId?: string; isDjBot?: boolean } | undefined,
  localId: string,
  dj: DjVolume,
  media: ParticipantVolumes,
  applyDjVolume: (value: number) => void,
) {
  const ownDj = dj.isDjModeActive
    && Boolean(user.isDjBot || remote?.isDjBot || user.id.startsWith('dj-'))
    && remote?.djOwnerId === localId
  return {
    volume: ownDj ? (dj.isMuted ? 0 : dj.volume)
      : media.participantVolumes[user.id] ?? (user.gameId ? media.participantVolumes[user.gameId] : undefined) ?? 100,
    setVolume(value: number) {
      if (ownDj) {
        dj.setVolume(value)
        applyDjVolume(value)
      } else {
        media.setParticipantVolume(user.id, value)
        if (user.name) media.setParticipantVolume(user.name, value)
      }
    },
  }
}
