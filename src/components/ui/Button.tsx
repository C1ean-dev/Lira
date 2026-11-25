import React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-mono transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lira-accent disabled:opacity-50 disabled:pointer-events-none select-none shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-lira-accent text-lira-ground border-2 border-lira-accent font-bold hover:bg-lira-ink hover:border-lira-ink',
        secondary:
          'bg-transparent text-lira-ink border-2 border-lira-accent font-semibold hover:bg-lira-surface hover:text-lira-accent',
        quiet:
          'bg-lira-surface text-lira-accent border border-lira-rule font-medium hover:border-lira-accent hover:text-lira-ink',
        ghost:
          'bg-transparent text-lira-muted border border-transparent font-medium hover:bg-lira-surface hover:text-lira-ink hover:border-lira-quiet',
        destructive:
          'bg-lira-surface text-lira-error border border-lira-error/50 font-bold hover:bg-lira-error hover:text-lira-ground hover:border-lira-error',
        danger:
          'bg-lira-surface text-lira-error border border-lira-error/50 font-bold hover:bg-lira-error hover:text-lira-ground hover:border-lira-error',
        icon:
          'bg-lira-surface text-lira-accent border border-lira-rule hover:border-lira-accent hover:text-lira-ink',
      },
      size: {
        xs: 'h-7 px-2.5 text-[11px] rounded-[8px]',
        sm: 'h-8 px-3 text-xs rounded-[8px]',
        md: 'h-10 px-4 text-xs rounded-[8px]',
        lg: 'h-11 px-5 text-sm rounded-[12px]',
        icon: 'h-9 w-9 p-0 rounded-[8px]',
        circle: 'h-11 w-11 p-0 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'
