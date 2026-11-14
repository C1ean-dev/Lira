// Transform Opus fmtp parameters for voice resilience against packet loss and NAT table pressure.
export function opusVoiceSdp(sdp: string): string {
  if (!sdp || !sdp.includes('m=audio')) return sdp
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(newline)
  const parameters: Record<string, string> = {
    useinbandfec: '1',
    packetlossperc: '10',
    usedtx: '1',
    maxaveragebitrate: '48000',
    minptime: '10',
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
        const match = /^a=rtpmap:(\d+) opus\/48000(?:\/2)?\s*$/i.exec(line)
        return match && advertised.has(match[1]) ? [match[1]] : []
      })
      for (const payload of opus) {
        const prefix = `a=fmtp:${payload} `
        const index = section.findIndex(line => line.startsWith(prefix))
        const values = new Map<string, string>()
        if (index >= 0) {
          for (const part of section[index].slice(prefix.length).split(';')) {
            const [key, ...value] = part.trim().split('=')
            if (key) values.set(key.toLowerCase(), value.join('='))
          }
        }
        for (const [key, value] of Object.entries(parameters)) {
          values.set(key, value)
        }
        const fmtp = prefix + [...values].map(([key, value]) => `${key}=${value}`).join(';')
        if (index >= 0) {
          section[index] = fmtp
        } else {
          const rtpmapIdx = section.findIndex(line => line.startsWith(`a=rtpmap:${payload} `))
          if (rtpmapIdx >= 0) {
            section.splice(rtpmapIdx + 1, 0, fmtp)
          } else {
            section.push(fmtp)
          }
        }
      }

      if (opus.length > 0) {
        const ptimeIdx = section.findIndex(line => line.startsWith('a=ptime:'))
        if (ptimeIdx >= 0) {
          section[ptimeIdx] = 'a=ptime:20'
        } else {
          let insertIdx = -1
          for (let i = section.length - 1; i >= 0; i--) {
            if (section[i].startsWith('a=fmtp:') || section[i].startsWith('a=rtpmap:')) {
              insertIdx = i
              break
            }
          }
          if (insertIdx >= 0) {
            section.splice(insertIdx + 1, 0, 'a=ptime:20')
          } else {
            section.push('a=ptime:20')
          }
        }

        const maxptimeIdx = section.findIndex(line => line.startsWith('a=maxptime:'))
        if (maxptimeIdx >= 0) {
          section[maxptimeIdx] = 'a=maxptime:60'
        } else {
          const ptimeNowIdx = section.findIndex(line => line.startsWith('a=ptime:'))
          if (ptimeNowIdx >= 0) {
            section.splice(ptimeNowIdx + 1, 0, 'a=maxptime:60')
          } else {
            section.push('a=maxptime:60')
          }
        }
      }
    }
    result.push(...section)
    start = limit
  }
  return result.join(newline)
}
