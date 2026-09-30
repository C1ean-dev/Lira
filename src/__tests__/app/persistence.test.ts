import { describe, it, expect, beforeEach } from 'vitest'

// Mock global localStorage
const mockStorage: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
  clear: () => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key]
    }
  },
}

// Attach to global window
;(globalThis as any).window = {
  localStorage: localStorageMock,
}
;(globalThis as any).localStorage = localStorageMock

import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useSavedSpacesStore } from '../../store/useSavedSpacesStore'
import { createEmptyWorkspace } from '../../editor/templates'

describe('Storage Persistence - Expected Behaviors', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  it('should persist profile name and avatar changes to localStorage', () => {
    const { setLocalPlayer } = useGameStore.getState()
    
    setLocalPlayer({
      name: 'DevMaster',
      avatar: {
        ...useGameStore.getState().localPlayer.avatar,
        hairColor: '#e03131',
        topColor: '#3b82f6',
      },
    })

    const raw = localStorageMock.getItem('gather_v2_user_profile')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.name).toBe('DevMaster')
    expect(parsed.avatar.hairColor).toBe('#e03131')
    expect(parsed.avatar.topColor).toBe('#3b82f6')
  })

  it('should persist status and emoji updates to localStorage', () => {
    const { setLocalStatus } = useGameStore.getState()
    
    setLocalStatus('focusing', 'Codando persistência...', '🚀')

    const raw = localStorageMock.getItem('gather_v2_user_profile')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.status).toBe('focusing')
    expect(parsed.statusText).toBe('Codando persistência...')
    expect(parsed.statusEmoji).toBe('🚀')
  })

  it('should persist private zones and room edits to localStorage', () => {
    const { addOrUpdateZone } = useMapStore.getState()
    
    const newZone = {
      id: 'test-zone-1',
      name: 'Sala de Guerra',
      color: '#ef4444',
      x: 5,
      y: 5,
      width: 6,
      height: 6,
      description: 'Sala de reunião',
    }

    addOrUpdateZone(newZone)

    const raw = localStorageMock.getItem('gather_v2_custom_map')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.zones.some((z: any) => z.name === 'Sala de Guerra')).toBe(true)
  })

  it('should persist furniture placement to localStorage', () => {
    const { addFurniture } = useMapStore.getState()
    
    const furn = {
      id: 'furn-test-1',
      defId: 'custom_lamp',
      x: 10,
      y: 8,
    }

    addFurniture(furn)

    const raw = localStorageMock.getItem('gather_v2_custom_map')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.furniture.some((f: any) => f.id === 'furn-test-1')).toBe(true)
  })

  it('should rename existing zones and persist the new name to localStorage', () => {
    const { addOrUpdateZone, renameZone } = useMapStore.getState()
    
    const zone = {
      id: 'test-zone-rename',
      name: 'Sala Antiga',
      color: '#20c997',
      x: 2,
      y: 2,
      width: 5,
      height: 5,
      description: '',
    }

    addOrUpdateZone(zone)
    renameZone('test-zone-rename', 'Sala Nova da Diretoria')

    const raw = localStorageMock.getItem('gather_v2_custom_map')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    const renamed = parsed.zones.find((z: any) => z.id === 'test-zone-rename')
    expect(renamed?.name).toBe('Sala Nova da Diretoria')
  })

  it('should persist available rooms (salas disponíveis) to localStorage', () => {
    const customRoom = {
      id: 'avail-test-1',
      name: 'Servidor Geral de Estudos',
      code: 'GATHER-ESTUDOS-01',
      color: '#3b82f6',
      description: 'Sala pública disponível para todos',
    }

    const rooms = [customRoom]
    localStorageMock.setItem('gather_v2_available_rooms', JSON.stringify(rooms))

    const raw = localStorageMock.getItem('gather_v2_available_rooms')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.length).toBe(1)
    expect(parsed[0].name).toBe('Servidor Geral de Estudos')
    expect(parsed[0].code).toBe('GATHER-ESTUDOS-01')
  })

  it('should allow host to toggle room privacy and sync with available rooms', () => {
    const { setRoomSession, toggleRoomPrivacy } = useGameStore.getState()
    
    // 1. Start room as host
    setRoomSession('GATHER-HOST-ROOM', true)
    expect(useGameStore.getState().isRoomPublic).toBe(false)

    // 2. Toggle to public
    toggleRoomPrivacy()
    expect(useGameStore.getState().isRoomPublic).toBe(true)
    let raw = localStorageMock.getItem('gather_v2_available_rooms')
    let parsed = JSON.parse(raw!)
    expect(parsed.some((r: any) => r.code === 'GATHER-HOST-ROOM')).toBe(true)

    // 3. Toggle back to private
    toggleRoomPrivacy()
    expect(useGameStore.getState().isRoomPublic).toBe(false)
    raw = localStorageMock.getItem('gather_v2_available_rooms')
    parsed = JSON.parse(raw!)
    expect(parsed.some((r: any) => r.code === 'GATHER-HOST-ROOM')).toBe(false)
  })

  it('should persist private room configuration, roles, admins and members to localStorage', () => {
    const { addOrUpdateZone, updateZone } = useMapStore.getState()
    
    const roomZone = {
      id: 'room-executiva-01',
      name: 'Sala Executiva Alpha',
      color: '#8b5cf6',
      x: 10,
      y: 10,
      width: 8,
      height: 6,
      description: 'Sala de diretoria executiva',
      admins: ['Alice', 'Bob'],
      members: ['Charlie', 'Dave'],
      isLocked: true,
      allowKnock: true,
      welcomeMessage: 'Bem-vindo à Diretoria! Reunião em andamento.',
    }

    addOrUpdateZone(roomZone)

    let raw = localStorageMock.getItem('gather_v2_custom_map')
    expect(raw).toBeTruthy()
    let parsed = JSON.parse(raw!)
    let savedZone = parsed.zones.find((z: any) => z.id === 'room-executiva-01')
    expect(savedZone).toBeTruthy()
    expect(savedZone.name).toBe('Sala Executiva Alpha')
    expect(savedZone.admins).toEqual(['Alice', 'Bob'])
    expect(savedZone.members).toEqual(['Charlie', 'Dave'])
    expect(savedZone.isLocked).toBe(true)
    expect(savedZone.welcomeMessage).toBe('Bem-vindo à Diretoria! Reunião em andamento.')

    // Update room settings
    updateZone('room-executiva-01', {
      name: 'Sala Executiva Principal',
      admins: ['Alice', 'Bob', 'Eve'],
      isLocked: false,
    })

    raw = localStorageMock.getItem('gather_v2_custom_map')
    parsed = JSON.parse(raw!)
    savedZone = parsed.zones.find((z: any) => z.id === 'room-executiva-01')
    expect(savedZone.name).toBe('Sala Executiva Principal')
    expect(savedZone.admins).toEqual(['Alice', 'Bob', 'Eve'])
    expect(savedZone.isLocked).toBe(false)
  })
})

