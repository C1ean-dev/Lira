// Apply only to DJ calls: both ends must request stereo rather than Opus' mono default.
export function djMusicSdp(sdp: string): string {
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(newline)
  const parameters: Record<string, string> = {
    stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '256000',
    maxplaybackrate: '48000', 'sprop-maxcapturerate': '48000',
    useinbandfec: '1', usedtx: '0',
  }
  const result: string[] = []
  let start = 0
  while (start < lines.length) {
    const end = lines.findIndex((line, index) => index > start && line.startsWith('m='))
    const limit = end < 0 ? lines.length : end
    const section = lines.slice(start, limit)
    if (section[0]?.startsWith('m=audio ')) {
      const advertised = new Set(section[0].trim().split(/\s+/).slice(3))
      const opus = section.flatMap(line => {
        const match = /^a=rtpmap:(\d+) opus\/48000\/2\s*$/i.exec(line)
        return match && advertised.has(match[1]) ? [match[1]] : []
      })
      for (const payload of opus) {
        const prefix = `a=fmtp:${payload} `
        const index = section.findIndex(line => line.startsWith(prefix))
        const values = new Map<string, string>()
        if (index >= 0) for (const part of section[index].slice(prefix.length).split(';')) {
          const [key, ...value] = part.trim().split('=')
          if (key) values.set(key.toLowerCase(), value.join('='))
        }
        for (const [key, value] of Object.entries(parameters)) values.set(key, value)
        const fmtp = prefix + [...values].map(([key, value]) => `${key}=${value}`).join(';')
        if (index >= 0) section[index] = fmtp
        else section.splice(section.findIndex(line => line.startsWith(`a=rtpmap:${payload} `)) + 1, 0, fmtp)
      }
    }
    result.push(...section)
    start = limit
  }
  return result.join(newline)
}
