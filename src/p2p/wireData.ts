// BinaryPack encodes undefined as null. Omit absent object fields before sending
// so optional fields retain the same meaning on JSON and binary connections.
// Keep explicit nulls (e.g. leaving a zone) and binary payloads intact.
export function omitUndefinedFields<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const items = value.map(omitUndefinedFields)
    return items.every((item, index) => item === value[index]) ? value : items as T
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
  let changed = false
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) { delete fields[key]; changed = true; continue }
    const next = omitUndefinedFields(item)
    fields[key] = next
    if (next !== item) changed = true
  }
  return changed ? fields as T : value
}
