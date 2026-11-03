export const MAX_WEB_URL_LENGTH = 4000

export function buildGithubWebUrl(payload: {
  title: string
  body: string
  repo?: string
  labels?: string[]
}): string {
  const repo = payload.repo ?? 'C1ean-dev/Lira'
  const labels = payload.labels ?? ['bug', 'needs-triage']

  let body = payload.body
  const baseLen = `https://github.com/${repo}/issues/new?title=&labels=${encodeURIComponent(labels.join(','))}&body=`.length
  const maxBodyLen = MAX_WEB_URL_LENGTH - baseLen - encodeURIComponent(payload.title).length - 100

  if (encodeURIComponent(body).length > maxBodyLen) {
    const notice = '\n\n...(logs truncados no link web; use o arquivo de logs para dados completos)'
    let sliceLen = Math.max(100, Math.floor(maxBodyLen / 3))
    while (encodeURIComponent(body.slice(0, sliceLen) + notice).length > maxBodyLen && sliceLen > 50) {
      sliceLen -= 50
    }
    body = body.slice(0, sliceLen) + notice
  }

  const params = new URLSearchParams()
  params.set('title', payload.title)
  params.set('body', body)
  params.set('labels', labels.join(','))

  return `https://github.com/${repo}/issues/new?${params.toString()}`
}
