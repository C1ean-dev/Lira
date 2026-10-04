import type React from 'react'
import type { AudioDeviceInfo } from '../../types/audio'
import type { DropdownOption } from '../common/CustomDropdown'

/**
 * Chromium lists the OS default a second time, as a device whose id is
 * literally "default" ("Default - <name>"). It is the same thing as our own
 * "Padrão do Sistema" option, so it is left out.
 */
const SYSTEM_DEFAULT_ID = 'default'

export function toDeviceOptions(
  devices: AudioDeviceInfo[],
  fallbackName: string,
  renderIcon: (className: string) => React.ReactNode
): DropdownOption<string>[] {
  const listed = new Set<string>([SYSTEM_DEFAULT_ID])
  const options: DropdownOption<string>[] = [
    {
      value: SYSTEM_DEFAULT_ID,
      label: `${fallbackName} Padrão do Sistema`,
      icon: renderIcon('w-3.5 h-3.5 text-indigo-400'),
    },
  ]
  for (const d of devices) {
    if (listed.has(d.deviceId)) continue
    listed.add(d.deviceId)
    options.push({
      value: d.deviceId,
      label: d.label || `${fallbackName} (${d.deviceId.slice(0, 8)}...)`,
      icon: renderIcon('w-3.5 h-3.5 text-slate-400'),
    })
  }
  return options
}
