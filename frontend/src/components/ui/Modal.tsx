import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';
import { cn } from './cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  mobileSheet?: boolean;
  closeLabel?: string;
}

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
};

export function Modal({ open, onClose, title, description, children, footer, size = 'md', mobileSheet = true, closeLabel = 'Закрыть' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousActive?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(
    <div className={cn('fixed inset-0 z-[140] flex justify-center bg-[var(--nt-color-overlay)] p-4', mobileSheet ? 'items-end sm:items-center' : 'items-center')} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1} className={cn('max-h-[min(88vh,760px)] w-full overflow-hidden rounded-[var(--nt-radius-modal)] border border-[var(--nt-color-border)] bg-[var(--nt-color-canvas)] text-[var(--nt-color-text)] shadow-[var(--nt-shadow-modal)] outline-none', sizes[size])}>
        <header className="flex items-start gap-3 border-b border-[var(--nt-color-border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-[var(--nt-color-text-muted)]">{description}</p>}
          </div>
          <IconButton variant="ghost" size="sm" aria-label={closeLabel} onClick={onClose}>×</IconButton>
        </header>
        <div className="max-h-[calc(min(88vh,760px)-132px)] overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--nt-color-border)] px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
