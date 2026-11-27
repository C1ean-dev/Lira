export interface DtlsBinding {
  local?: string
  remote?: string
}

const FINGERPRINT_RE = /^a=fingerprint:sha-256\s+([a-fA-F0-9:]+)$/i

export function extractDtlsFingerprints(sdp?: string | null): string[] {
  if (!sdp || typeof sdp !== 'string') return []
  const unique = new Set<string>()
  for (const rawLine of sdp.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = FINGERPRINT_RE.exec(line)
    if (match?.[1]) {
      unique.add(`sha-256:${match[1].toLowerCase()}`)
    }
  }
  return Array.from(unique).sort()
}

export function extractPrimaryDtlsFingerprint(sdp?: string | null): string | undefined {
  const fps = extractDtlsFingerprints(sdp)
  return fps.length > 0 ? fps.join(',') : undefined
}

export function getConnectionDtlsBinding(pc?: RTCPeerConnection | null): DtlsBinding {
  if (!pc) return {}
  const anyPc = pc as unknown as {
    localDescription?: { sdp?: string } | null
    remoteDescription?: { sdp?: string } | null
    currentLocalDescription?: { sdp?: string } | null
    currentRemoteDescription?: { sdp?: string } | null
  }
  const localSdp = anyPc.localDescription?.sdp || anyPc.currentLocalDescription?.sdp
  const remoteSdp = anyPc.remoteDescription?.sdp || anyPc.currentRemoteDescription?.sdp
  return {
    local: extractPrimaryDtlsFingerprint(localSdp),
    remote: extractPrimaryDtlsFingerprint(remoteSdp),
  }
}
