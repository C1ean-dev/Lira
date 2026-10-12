import { describe, expect, it, vi } from 'vitest'
import { participantVolumeControl } from '../../media/participantVolumeControl'

function setup() {
  const dj = { isDjModeActive: true, volume: 16, isMuted: false, setVolume: vi.fn() }
  const media = { participantVolumes: { 'dj-room': 100 }, setParticipantVolume: vi.fn() }
  const apply = vi.fn()
  const user = { id: 'dj-room', name: 'DJ', isDjBot: true }
  return { dj, media, apply, user }
}

describe('participant volume shared with the DJ player', () => {
  it('shows the player volume in the owner DJ menu instead of a second gain', () => {
    const s = setup()
    const control = participantVolumeControl(s.user, { djOwnerId: 'owner' }, 'owner', s.dj, s.media, s.apply)
    expect(control.volume).toBe(16)
    control.setVolume(150)
    expect(s.dj.setVolume).toHaveBeenCalledWith(150)
    expect(s.apply).toHaveBeenCalledWith(150)
    expect(s.media.setParticipantVolume).not.toHaveBeenCalled()
  })
  it('shows mute as zero and lets volume presets restore the player', () => {
    const s = setup(); s.dj.isMuted = true
    const control = participantVolumeControl(s.user, { djOwnerId: 'owner' }, 'owner', s.dj, s.media, s.apply)
    expect(control.volume).toBe(0)
    control.setVolume(200)
    expect(s.dj.setVolume).toHaveBeenCalledWith(200)
    expect(s.apply).toHaveBeenCalledWith(200)
  })
  it('keeps a listener volume local without changing another owner player', () => {
    const s = setup()
    const control = participantVolumeControl(s.user, { djOwnerId: 'other' }, 'owner', s.dj, s.media, s.apply)
    expect(control.volume).toBe(100)
    control.setVolume(60)
    expect(s.media.setParticipantVolume).toHaveBeenCalledWith('dj-room', 60)
    expect(s.dj.setVolume).not.toHaveBeenCalled()
    expect(s.apply).not.toHaveBeenCalled()
  })
  it('leaves normal participant volume and name aliases unchanged', () => {
    const s = setup()
    const control = participantVolumeControl({ id: 'person', name: 'Pessoa' }, undefined, 'owner', s.dj,
      { ...s.media, participantVolumes: { person: 80 } }, s.apply)
    expect(control.volume).toBe(80)
    control.setVolume(200)
    expect(s.media.setParticipantVolume).toHaveBeenCalledWith('person', 200)
    expect(s.media.setParticipantVolume).toHaveBeenCalledWith('Pessoa', 200)
    expect(s.dj.setVolume).not.toHaveBeenCalled()
  })
})
