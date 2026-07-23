import { useMemo, useState } from 'react';
import type { PageNode } from '../../types';

const ICON_CATEGORIES: { title: string; icons: string[] }[] = [
  {
    title: 'Цифры',
    icons: ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '#️⃣', '*️⃣', '🔢', '💯', '🆔'],
  },
  {
    title: 'Буквы и знаки',
    icons: ['🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆚', '🔤', '🔡', '🔠', '❇️', '✳️', '✴️', '❎', '✅', '❌', '➕', '➖', '➗', '✖️', '❓', '❗', '‼️', '⁉️'],
  },
  {
    title: 'Документы и работа',
    icons: ['📄', '📝', '📃', '📑', '🧾', '📊', '📈', '📉', '📋', '📁', '📂', '🗂️', '🗃️', '🗄️', '📇', '📌', '📍', '📎', '🖇️', '📐', '📏', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '✏️', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🏷️'],
  },
  {
    title: 'Задачи и цели',
    icons: ['✅', '☑️', '✔️', '🎯', '🏁', '🚩', '⏰', '⏱️', '⏲️', '🕐', '📅', '📆', '🗓️', '⌛', '⏳', '🔔', '🔕', '📣', '📢', '💬', '🗯️', '💭', '🔥', '⚡', '💡', '⭐', '🌟', '✨', '💫', '🏆', '🥇', '🥈', '🥉', '🎖️', '🏅'],
  },
  {
    title: 'Деньги и бизнес',
    icons: ['💰', '💵', '💴', '💶', '💷', '💸', '💳', '🧧', '🪙', '💎', '⚖️', '🏦', '🏢', '🏬', '📦', '🛒', '🛍️', '🧮', '💹', '🤝', '📮', '💼', '🗳️'],
  },
  {
    title: 'Общение и люди',
    icons: ['👤', '👥', '🧑', '👨', '👩', '🧒', '👶', '👴', '👵', '🙋', '🙏', '👍', '👎', '👏', '🤝', '💪', '🫡', '🧠', '👀', '🗣️', '👣', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎'],
  },
  {
    title: 'Дом и места',
    icons: ['🏠', '🏡', '🏘️', '🏢', '🏭', '🏫', '🏥', '⛪', '🕌', '⛺', '🏕️', '🌆', '🌃', '🗺️', '🧭', '🚗', '🚕', '🚌', '✈️', '🚀', '🛸', '⚓', '🚢'],
  },
  {
    title: 'Технологии',
    icons: ['💻', '🖥️', '⌨️', '🖱️', '🖨️', '📱', '☎️', '📞', '📟', '📠', '🔌', '🔋', '💾', '💿', '📀', '🎥', '📷', '📸', '🎬', '📺', '📻', '🎙️', '🎤', '🎧', '🔗', '⚙️', '🛠️', '🔧', '🔨', '🧰', '🔒', '🔓', '🔑', '🗝️', '🛡️'],
  },
  {
    title: 'Природа и еда',
    icons: ['🌍', '🌳', '🌲', '🌴', '🌵', '🌱', '🍀', '🌿', '🌸', '🌼', '🌻', '🌹', '🍎', '🍊', '🍋', '🍇', '🍓', '🍔', '🍕', '☕', '🍵', '🍰', '🎂', '🍺', '🥂', '☀️', '🌙', '⛅', '🌈', '❄️', '💧', '🔥'],
  },
  {
    title: 'Досуг и разное',
    icons: ['🎨', '🎭', '🎮', '🎲', '🧩', '♟️', '🎸', '🎹', '🎺', '🎻', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🥊', '🏋️', '🚴', '🏃', '🧘', '🎓', '🩺', '💊', '🧪', '🔬', '🔭', '🧲', '🎁', '🎉', '🎊', '🏷️', '📌', '⛳'],
  },
];

const ALL_ICONS = ICON_CATEGORIES.flatMap((category) => category.icons);

interface Props {
  node: PageNode;
  onSelect: (icon: string) => void;
  onClose: () => void;
}

export default function IconPickerModal({ node, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    // Простой поиск: показываем иконки, содержащие введённый символ (для эмодзи)
    const matches = ALL_ICONS.filter((icon) => icon.includes(q));
    return matches.length ? matches : ALL_ICONS;
  }, [query]);

  const pick = (icon: string) => {
    onSelect(icon);
    onClose();
  };

  const gridClass = 'grid grid-cols-6 gap-2 sm:grid-cols-8';
  const buttonClass = (icon: string) =>
    `flex aspect-square items-center justify-center rounded-[12px] text-2xl active:scale-[0.96] ${
      node.icon === icon ? 'bg-[var(--tg-theme-button-color)]' : 'bg-[var(--tg-theme-secondary-bg-color)]'
    }`;

  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full flex-col rounded-t-2xl bg-[var(--tg-theme-bg-color)] p-4"
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
            className="h-9 w-9 shrink-0 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск иконки…"
          className="mb-3 w-full rounded-[12px] bg-[var(--tg-theme-secondary-bg-color)] px-3 py-2.5 text-sm text-[var(--tg-theme-text-color)] outline-none"
        />

        <div className="flex-1 overflow-y-auto pb-2">
          {filtered ? (
            <div className={gridClass}>
              {filtered.map((icon, index) => (
                <button key={`${icon}-${index}`} type="button" onClick={() => pick(icon)} className={buttonClass(icon)}>
                  {icon}
                </button>
              ))}
            </div>
          ) : (
            ICON_CATEGORIES.map((category) => (
              <div key={category.title} className="mb-4">
                <p className="mb-2 px-1 text-[11px] font-semibold uppercase text-[var(--tg-theme-hint-color)]">
                  {category.title}
                </p>
                <div className={gridClass}>
                  {category.icons.map((icon, index) => (
                    <button key={`${icon}-${index}`} type="button" onClick={() => pick(icon)} className={buttonClass(icon)}>
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
