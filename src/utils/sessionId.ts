export const SESSION_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? (crypto as Crypto).randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
