import React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

export const cardVariants = cva('rounded-[12px] text-lira-ink', {
  variants: {
    variant: {
      panel: 'bg-lira-panel border border-lira-quiet',
      surface: 'bg-lira-surface border border-lira-rule',
      dashed: 'bg-lira-panel border border-dashed border-lira-rule',
      ground: 'bg-lira-ground border border-lira-quiet',
    },
  },
  defaultVariants: {
    variant: 'panel',
  },
})

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  )
)
Card.displayName = 'Card'

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col space-y-1.5 p-4 border-b border-dashed border-lira-quiet',
        className
      )}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('font-display text-lg font-bold leading-tight text-lira-accent', className)}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-xs font-mono text-lira-muted', className)} {...props} />
))
CardDescription.displayName = 'CardDescription'

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4', className)} {...props} />
)
CardContent.displayName = 'CardContent'

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-end gap-2 p-4 border-t border-dashed border-lira-quiet',
        className
      )}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'
