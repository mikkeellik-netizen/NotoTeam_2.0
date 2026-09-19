import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--nt-color-accent)] text-[var(--nt-color-accent-text)] hover:brightness-[1.04] active:brightness-95',
  secondary: 'border border-[var(--nt-color-border)] bg-[var(--nt-color-surface)] text-[var(--nt-color-text)] hover:bg-[var(--nt-color-surface-hover)]',
  ghost: 'bg-transparent text-[var(--nt-color-link)] hover:bg-[var(--nt-color-surface)]',
  danger: 'bg-[var(--nt-color-danger)] text-white hover:brightness-[1.04] active:brightness-95',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-[var(--nt-control-sm)] px-3 text-xs',
  md: 'min-h-[var(--nt-control-md)] px-4 text-sm',
  lg: 'min-h-[var(--nt-control-lg)] px-5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    type = 'button',
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    disabled,
    startIcon,
    endIcon,
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--nt-radius-control)] font-semibold transition-[background-color,filter,transform,box-shadow] duration-[var(--nt-motion-fast)] ease-[var(--nt-ease-standard)] focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : startIcon}
      <span className="min-w-0 truncate">{children}</span>
      {!loading && endIcon}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'startIcon' | 'endIcon' | 'block'> {
  'aria-label': string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', className, children, ...props },
  ref,
) {
  const square = size === 'sm' ? 'h-[var(--nt-control-sm)] w-[var(--nt-control-sm)]' : size === 'lg' ? 'h-[var(--nt-control-lg)] w-[var(--nt-control-lg)]' : 'h-[var(--nt-control-md)] w-[var(--nt-control-md)]';
  return (
    <Button ref={ref} size={size} className={cn('px-0', square, className)} {...props}>
      <span className="flex h-5 w-5 items-center justify-center" aria-hidden="true">{children}</span>
    </Button>
  );
});
