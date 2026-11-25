import React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../../lib/cn'

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-lira-rule transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lira-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-lira-accent data-[state=checked]:bg-lira-accent data-[state=unchecked]:bg-lira-ground',
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-3.5 w-3.5 rounded-full transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-lira-ground data-[state=unchecked]:translate-x-0.5 data-[state=unchecked]:bg-lira-muted'
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName
