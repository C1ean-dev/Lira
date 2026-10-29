export function collectProjectImageUrls(document, readSpriteFrame) {
  const urls = new Set()
  function visit(value) {
    if (typeof value === 'string') {
      const source = readSpriteFrame(value)?.source || value
      if (/\/(?:images|sprites\/[^/]+)\/[a-f0-9]{64}\.(png|webp|jpg|gif)$/.test(source)) urls.add(source)
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(document)
  return [...urls]
}
