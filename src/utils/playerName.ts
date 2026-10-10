function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function resolveUniquePlayerName(incomingName: string, existingNames: string[]): string {
  const trimmed = (incomingName || '').trim() || 'Player'

  const validExisting = existingNames.filter(Boolean).map((n) => n.trim())

  const hasConflict = validExisting.some(
    (name) => name.toLowerCase() === trimmed.toLowerCase()
  )

  if (!hasConflict) {
    return trimmed
  }

  const baseName = trimmed.replace(/\s*#\d+$/, '').trim() || trimmed

  const regex = new RegExp(`^${escapeRegex(baseName)}(\\s*#(\\d+))?$`, 'i')
  const usedNumbers = new Set<number>()

  for (const name of validExisting) {
    const match = name.match(regex)
    if (match) {
      if (match[2]) {
        usedNumbers.add(parseInt(match[2], 10))
      } else {
        usedNumbers.add(1)
      }
    }
  }

  let nextNum = 2
  while (usedNumbers.has(nextNum)) {
    nextNum++
  }

  return `${baseName} #${nextNum}`
}
