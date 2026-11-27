export function installSilentJsdomCanvasGetContext(
  canvasProto: Pick<typeof HTMLCanvasElement.prototype, 'getContext'> | null =
    typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement.prototype : null,
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): boolean {
  if (!canvasProto || !/\bjsdom\b/i.test(userAgent)) return false
  const descriptor = Object.getOwnPropertyDescriptor(canvasProto, 'getContext')
  if (descriptor && !descriptor.configurable && !descriptor.writable) return false
  Object.defineProperty(canvasProto, 'getContext', {
    configurable: true,
    writable: true,
    value: function getContext() {
      return null
    },
  })
  return true
}

installSilentJsdomCanvasGetContext()
