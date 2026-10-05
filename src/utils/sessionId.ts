/**
 * Identifies one run of a renderer process. The same id is on every line this
 * window writes to lira-<day>.log, on its call-debug entries and on its error
 * reports, so the three files can be read side by side and the windows of a
 * multi-instance run can be told apart.
 */
export const SESSION_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? (crypto as Crypto).randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
