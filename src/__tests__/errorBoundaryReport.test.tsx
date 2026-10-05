import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ErrorBoundary, buildErrorScreenText } from '../components/ErrorBoundary'
import { getBufferedLogs, __resetLoggerForTests } from '../utils/logger'
import { diagLog, __resetDiagForTests } from '../utils/diagnosticLogger'
import { registerReportContext, __resetReportContextForTests } from '../utils/reportContext'

const COMPONENT_STACK = '\n    at ChatDrawer (http://localhost:5173/src/components/ChatDrawer.tsx:120:5)\n    at App (http://localhost:5173/src/App.tsx:47:33)'

const renderError = () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'roomId')")
  error.stack = `TypeError: Cannot read properties of undefined (reading 'roomId')\n    at ChatDrawer (http://localhost:5173/src/components/ChatDrawer.tsx:131:20)`
  return error
}

/** The boundary as React drives it, without a DOM: setState applied at once. */
const makeBoundary = () => {
  const boundary = new ErrorBoundary({ children: null })
  boundary.setState = ((update: Record<string, unknown>) => {
    boundary.state = { ...boundary.state, ...update } as typeof boundary.state
  }) as typeof boundary.setState
  return boundary
}

describe('error screen', () => {
  beforeEach(() => {
    __resetLoggerForTests()
    __resetDiagForTests()
    __resetReportContextForTests()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    __resetLoggerForTests()
    __resetDiagForTests()
    __resetReportContextForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports the render error as fatal, with the component stack', () => {
    const boundary = makeBoundary()
    const error = renderError()
    boundary.componentDidCatch(error, { componentStack: COMPONENT_STACK })

    const [record] = getBufferedLogs()
    expect(record).toMatchObject({ level: 'error', scope: 'ErrorBoundary' })
    expect(record.report).toMatchObject({
      kind: 'react',
      severity: 'fatal',
      scope: 'ErrorBoundary',
      error: { name: 'TypeError', frames: [{ fn: 'ChatDrawer', file: 'src/components/ChatDrawer.tsx', line: 131, col: 20, app: true }] },
      componentStack: [
        { fn: 'ChatDrawer', file: 'src/components/ChatDrawer.tsx', line: 120, col: 5, app: true },
        { fn: 'App', file: 'src/App.tsx', line: 47, col: 33, app: true },
      ],
    })
  })

  it('keeps the error, the component stack and the report for the screen', () => {
    const boundary = makeBoundary()
    const error = renderError()
    boundary.componentDidCatch(error, { componentStack: COMPONENT_STACK })

    expect(boundary.state.error).toBe(error)
    expect(boundary.state.errorInfo?.componentStack).toBe(COMPONENT_STACK)
    expect(boundary.state.report?.id).toBe(getBufferedLogs()[0].report?.id)
  })

  it('copies the report with the state of the app and what happened before the error', () => {
    registerReportContext('room', () => ({ inRoom: true, role: 'guest' }))
    diagLog('room', 'join-open', { roomCode: 'R1' })
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'Lira/1.1.81 Electron/33.2.0' })
    const boundary = makeBoundary()
    boundary.componentDidCatch(renderError(), { componentStack: COMPONENT_STACK })
    ;(boundary as unknown as { handleCopyError: () => void }).handleCopyError()

    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('=== LIRA ERROR REPORT ===')
    expect(text).toContain(`Report: ${boundary.state.report!.id} (fingerprint ${boundary.state.report!.fingerprint}`)
    expect(text).toContain("Message: Cannot read properties of undefined (reading 'roomId')")
    expect(text).toContain('=== WHAT THE APP WAS DOING ===')
    expect(text).toContain('room  {"inRoom":true,"role":"guest"}')
    expect(text).toContain('room/join-open  {"roomCode":"R1"}')
    expect(text).toContain('> ChatDrawer (src/components/ChatDrawer.tsx:120:5)')
  })
})

describe('buildErrorScreenText', () => {
  it('still gives the error when there is no report', () => {
    const text = buildErrorScreenText({
      error: renderError(),
      componentStack: COMPONENT_STACK,
      report: null,
      timestamp: '2026-10-04T10:00:00.000Z',
      url: 'http://localhost:5173/',
      userAgent: 'test',
    })

    expect(text).toContain('Timestamp: 2026-10-04T10:00:00.000Z')
    expect(text).toContain('Type: TypeError')
    expect(text).toContain('=== REACT COMPONENT TREE STACK ===')
    expect(text).not.toContain('Report:')
    expect(text).not.toContain('=== WHAT THE APP WAS DOING ===')
  })

  it('survives a missing error', () => {
    const text = buildErrorScreenText({ error: null, componentStack: null, report: null, timestamp: 't', url: 'u', userAgent: 'a' })
    expect(text).toContain('Message: Unknown Error')
    expect(text).toContain('No stack trace available')
  })
})
