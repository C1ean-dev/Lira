import React from 'react'
import { createRoot } from 'react-dom/client'
import { WhiteboardPanel } from '../../src/components/collaboration/WhiteboardPanel'
import { useWhiteboardStore } from '../../src/store/useWhiteboardStore'
import { useGameStore } from '../../src/store/useGameStore'
import '../../src/index.css'

useGameStore.setState({ isConnected: false, roomId: 'editor-browser-test' })
await useWhiteboardStore.getState().selectRoom('editor-browser-test')
useWhiteboardStore.getState().setOpen(true)
Object.assign(window, { whiteboardTest: { board: useWhiteboardStore, game: useGameStore } })
createRoot(document.getElementById('root')!).render(<WhiteboardPanel />)
