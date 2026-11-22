import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[11px] font-mono font-semibold leading-tight select-none shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-lira-surface text-lira-accent border-lira-rule',
        accent: 'bg-lira-accent text-lira-ground border-lira-accent font-bold',
        online: 'bg-lira-online/15 text-lira-online border-lira-online/40',
        error: 'bg-lira-error/15 text-lira-error border-lira-error/40',
        amber: 'bg-lira-amber/15 text-lira-amber border-lira-amber/40',
        quiet: 'bg-lira-ground text-lira-muted border-lira-quiet',
        dashed: 'bg-lira-surface text-lira-muted border-dashed border-lira-rule',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
)
Badge.displayName = 'Badge'
