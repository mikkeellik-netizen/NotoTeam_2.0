import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

interface FieldFrameProps {
  id: string;
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

function FieldFrame({ id, label, hint, error, children, className }: FieldFrameProps) {
  const message = error ?? hint;
  const messageId = message ? `${id}-message` : undefined;
  return (
    <label htmlFor={id} className={cn('block min-w-0', className)}>
      {label && <span className="mb-1.5 block text-xs font-semibold text-[var(--nt-color-text-muted)]">{label}</span>}
      {children}
      {message && <span id={messageId} className={cn('mt-1.5 block text-xs', error ? 'text-[var(--nt-color-danger)]' : 'text-[var(--nt-color-text-muted)]')}>{message}</span>}
    </label>
  );
}

const controlClass = 'min-h-[var(--nt-control-md)] w-full rounded-[var(--nt-radius-control)] border border-[var(--nt-color-border)] bg-[var(--nt-color-surface-raised)] px-3 text-sm text-[var(--nt-color-text)] outline-none transition-[border-color,box-shadow,background-color] duration-[var(--nt-motion-fast)] placeholder:text-[var(--nt-color-text-muted)] focus:border-[var(--nt-color-accent)] focus:shadow-[var(--nt-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  startAdornment?: ReactNode;
  containerClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id: providedId, label, hint, error, startAdornment, containerClassName, className, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const messageId = error || hint ? `${id}-message` : undefined;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} className={containerClassName}>
      <span className="relative block">
        {startAdornment && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[var(--nt-color-text-muted)]">{startAdornment}</span>}
        <input ref={ref} id={id} aria-invalid={Boolean(error) || undefined} aria-describedby={messageId} className={cn(controlClass, Boolean(startAdornment) && 'pl-8', className)} {...props} />
      </span>
    </FieldFrame>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { id: providedId, label, hint, error, containerClassName, className, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} className={containerClassName}>
      <textarea ref={ref} id={id} aria-invalid={Boolean(error) || undefined} aria-describedby={error || hint ? `${id}-message` : undefined} className={cn(controlClass, 'resize-y py-3', className)} {...props} />
    </FieldFrame>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id: providedId, label, hint, error, containerClassName, className, children, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} className={containerClassName}>
      <select ref={ref} id={id} aria-invalid={Boolean(error) || undefined} aria-describedby={error || hint ? `${id}-message` : undefined} className={cn(controlClass, 'appearance-none pr-9', className)} {...props}>{children}</select>
    </FieldFrame>
  );
});
