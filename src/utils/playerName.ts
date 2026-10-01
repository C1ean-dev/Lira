function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolves a unique player name by appending a #number if the name already exists
 * among players in the room.
 *
 * Rules:
 * - If no conflict exists, keeps the name as-is.
 * - If a duplicate is detected (case-insensitive), appends #2, #3, etc.
 *
 * Examples:
 * - resolveUniquePlayerName('Player', ['Player']) => 'Player #2'
 * - resolveUniquePlayerName('Player', ['Player', 'Player #2']) => 'Player #3'
 * - resolveUniquePlayerName('Carlos', ['Ana', 'Bob']) => 'Carlos'
 */
export function resolveUniquePlayerName(incomingName: string, existingNames: string[]): string {
  const trimmed = (incomingName || '').trim() || 'Player'

  // Filter out empty or null names
  const validExisting = existingNames.filter(Boolean).map((n) => n.trim())

  // Check if there is an exact case-insensitive match
  const hasConflict = validExisting.some(
    (name) => name.toLowerCase() === trimmed.toLowerCase()
  )

  if (!hasConflict) {
    return trimmed
  }

  // Base name without any existing trailing " #\d+" suffix
  const baseName = trimmed.replace(/\s*#\d+$/, '').trim() || trimmed

  // Find all used numbers for this baseName
  // Matches "baseName", "baseName #1", "baseName #2", etc.
  const regex = new RegExp(`^${escapeRegex(baseName)}(\\s*#(\\d+))?$`, 'i')
  const usedNumbers = new Set<number>()

  for (const name of validExisting) {
    const match = name.match(regex)
    if (match) {
      if (match[2]) {
        usedNumbers.add(parseInt(match[2], 10))
      } else {
        // The unnumbered base name counts as #1
        usedNumbers.add(1)
      }
    }
  }

  // Find the lowest available number >= 2
  let nextNum = 2
  while (usedNumbers.has(nextNum)) {
    nextNum++
  }

  return `${baseName} #${nextNum}`
}
