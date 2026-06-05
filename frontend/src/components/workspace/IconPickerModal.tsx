import type { PageNode } from '../../types';

const EMOJI_OPTIONS = [
  '📄',
  '📝',
  '📁',
  '📋',
  '✅',
  '📥',
  '📅',
  '⏰',
  '💡',
  '🎯',
  '🚀',
  '⭐',
  '🔥',
  '📌',
  '📊',
  '💰',
  '📚',
  '🎤',
  '⛺',
  '🙏',
  '🧠',
  '🔗',
  '🗂️',
  '⚙️',
];

interface Props {
  node: PageNode;
  onSelect: (icon: string) => void;
  onClose: () => void;
}

export default function IconPickerModal({ node, onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-black/50" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--tg-theme-text-color)]">Сменить иконку</h3>
            <p className="truncate text-xs text-[var(--tg-theme-hint-color)]">{node.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
          {EMOJI_OPTIONS.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => {
                onSelect(icon);
                onClose();
              }}
              className={`flex aspect-square items-center justify-center rounded-[12px] text-2xl active:scale-[0.96] ${
                node.icon === icon
                  ? 'bg-[var(--tg-theme-button-color)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color)]'
              }`}
              aria-label={`Выбрать ${icon}`}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
