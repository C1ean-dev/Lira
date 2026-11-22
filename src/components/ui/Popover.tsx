import React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '../../lib/cn'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor
export const PopoverPortal = PopoverPrimitive.Portal

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 rounded-[12px] border border-dashed border-lira-rule bg-lira-panel p-3.5 text-lira-ink outline-none',
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName
