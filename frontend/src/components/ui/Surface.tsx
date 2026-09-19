import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'default' | 'raised' | 'muted';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const tones = {
  default: 'border border-[var(--nt-color-border)] bg-[var(--nt-color-surface)]',
  raised: 'border border-[var(--nt-color-border)] bg-[var(--nt-color-surface-raised)] shadow-[var(--nt-shadow-sm)]',
  muted: 'bg-[var(--nt-color-surface)]',
};

const paddings = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { tone = 'default', padding = 'md', className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('rounded-[var(--nt-radius-surface)] text-[var(--nt-color-text)]', tones[tone], paddings[padding], className)} {...props} />;
});
