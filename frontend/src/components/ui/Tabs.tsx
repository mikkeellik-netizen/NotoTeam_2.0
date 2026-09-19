import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  value: T;
  options: Array<TabOption<T>>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function Tabs<T extends string>({ value, options, onChange, label, className }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex min-w-0 gap-1 overflow-x-auto rounded-[var(--nt-radius-control)] border border-[var(--nt-color-border)] bg-[var(--nt-color-surface)] p-1', className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-[var(--nt-control-sm)] shrink-0 items-center justify-center gap-2 rounded-[var(--nt-radius-sm)] px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--nt-focus-ring)] disabled:opacity-40',
              selected ? 'bg-[var(--nt-color-canvas)] text-[var(--nt-color-text)] shadow-[var(--nt-shadow-sm)]' : 'text-[var(--nt-color-text-muted)] hover:text-[var(--nt-color-text)]',
            )}
          >
            {option.icon && <span aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
