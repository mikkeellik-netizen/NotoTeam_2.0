import { useEffect } from 'react';

export interface ContextMenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  title?: string;
  displayTitle?: string;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ title, displayTitle, x, y, items, onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 250);
  const top = Math.min(y, window.innerHeight - 320);

  return (
    <div className="fixed inset-0 z-[95]" onClick={onClose}>
      <div
        className="absolute w-60 overflow-hidden rounded-[14px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-bg-color)] shadow-2xl"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onClick={(event) => event.stopPropagation()}
      >
        {(displayTitle || title) && (
          <div className="border-b border-[var(--tg-theme-secondary-bg-color)] px-3 py-2">
            <p className="truncate text-xs font-semibold text-[var(--tg-theme-hint-color)]">{displayTitle || title}</p>
          </div>
        )}
        <div className="p-1">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                onClose();
              }}
              className={`block w-full rounded-[10px] px-3 py-2.5 text-left text-sm font-medium disabled:opacity-40 ${
                item.danger ? 'text-red-400' : 'text-[var(--tg-theme-text-color)]'
              } active:bg-[var(--tg-theme-secondary-bg-color)]`}
            >
              <span className="block truncate">{item.label}</span>
              {item.hint && <span className="block truncate text-xs font-normal text-[var(--tg-theme-hint-color)]">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
