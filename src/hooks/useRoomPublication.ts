import { useCallback, useEffect, useState } from 'react'
import { PublicRoomsService } from '../services/publicRoomsService'

export function useRoomPublication(roomId: string | null) {
  const service = PublicRoomsService.getInstance()
  const read = useCallback(() => roomId ? service.getRoomPublicationServers(roomId) : [], [service, roomId])
  const [publication, setPublication] = useState(() => ({ roomId, servers: read() }))

  useEffect(() => {
    const update = () => setPublication({ roomId, servers: read() })
    const unsubscribeRooms = service.subscribe(update)
    const unsubscribeStatus = service.subscribeBrokerStatus(update)
    return () => { unsubscribeRooms(); unsubscribeStatus() }
  }, [service, roomId, read])

  return publication.roomId === roomId ? publication.servers : read()
}
