import { useEffect, useState } from 'react';
import { fetchProjectFileBlob, projectFileIcon } from '../../api/projectFiles';
import type { FileBlockContent } from '../../types';

interface Props {
  projectId: string;
  content: FileBlockContent;
  canEdit: boolean;
  onUpdate: (content: FileBlockContent) => void;
}

export default function FileBlock({ projectId, content, canEdit, onUpdate }: Props) {
  const [objectUrl, setObjectUrl] = useState('');
  const [loading, setLoading] = useState(content.category === 'image' || content.category === 'audio');
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!content.fileId || (content.category !== 'image' && content.category !== 'audio')) return;
    let active = true;
    let url = '';
    setLoading(true);
    setError('');
    fetchProjectFileBlob(projectId, content.fileId)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось открыть файл');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [content.category, content.fileId, projectId, reloadKey]);

  const getFile = async (action: 'download' | 'open') => {
    if (!content.fileId || actionBusy) return;
    setActionBusy(true);
    setError('');
    try {
      const blob = await fetchProjectFileBlob(projectId, content.fileId);
      const url = URL.createObjectURL(blob);
      if (action === 'open') {
        const opened = window.open(url, '_blank');
        if (opened) opened.opener = null;
        if (!opened) downloadUrl(url, content.fileName);
      } else {
        downloadUrl(url, content.fileName);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось получить файл');
    } finally {
      setActionBusy(false);
    }
  };

  const canOpen = content.category === 'image' || content.category === 'audio' || content.mimeType === 'application/pdf';

  return (
    <section className="overflow-hidden rounded-[8px] border border-[var(--tg-theme-secondary-bg-color)] bg-[var(--tg-theme-secondary-bg-color)]">
      {content.category === 'image' && (
        <div className="flex min-h-32 items-center justify-center bg-black/10">
          {loading ? (
            <p className="py-10 text-sm text-[var(--tg-theme-hint-color)]">Загрузка изображения…</p>
          ) : objectUrl ? (
            <button type="button" onClick={() => void getFile('open')} className="block w-full" title="Открыть изображение">
              <img src={objectUrl} alt={content.caption || content.fileName} className="max-h-[520px] w-full object-contain" />
            </button>
          ) : null}
        </div>
      )}

      {content.category === 'audio' && (
        <div className="px-3 pt-3">
          {loading ? (
            <p className="py-3 text-sm text-[var(--tg-theme-hint-color)]">Загрузка аудио…</p>
          ) : objectUrl ? (
            <audio controls preload="metadata" src={objectUrl} className="h-11 w-full" />
          ) : null}
        </div>
      )}

      <div className="p-3">
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[var(--tg-theme-bg-color)] text-xl">
            {projectFileIcon(content)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--tg-theme-text-color)]">{content.fileName || 'Файл'}</p>
            <p className="text-xs text-[var(--tg-theme-hint-color)]">{fileKindLabel(content)} · {formatBytes(content.size)}</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
          {canOpen && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void getFile('open')}
              className="rounded-[8px] bg-[var(--tg-theme-bg-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-45"
            >
              Открыть
            </button>
          )}
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => void getFile('download')}
            className="rounded-[8px] bg-[var(--tg-theme-button-color)] px-3 py-2 text-xs font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-45"
          >
            Скачать
          </button>
          </div>
        </div>

        {canEdit ? (
          <input
            value={content.caption ?? ''}
            onChange={(event) => onUpdate({ ...content, caption: event.target.value })}
            className="mt-3 w-full bg-transparent text-sm text-[var(--tg-theme-text-color)] outline-none placeholder:text-[var(--tg-theme-hint-color)]"
            placeholder="Добавить подпись"
          />
        ) : content.caption ? (
          <p className="mt-3 text-sm text-[var(--tg-theme-text-color)]">{content.caption}</p>
        ) : null}

        {error && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-[8px] bg-red-500/10 px-3 py-2">
            <p className="text-xs text-red-400">{error}</p>
            {(content.category === 'image' || content.category === 'audio') && (
              <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="text-xs font-semibold text-red-400">
                Повторить
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function downloadUrl(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || 'file';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function fileKindLabel(content: FileBlockContent) {
  if (content.category === 'image') return 'Изображение';
  if (content.category === 'audio') return 'Аудио';
  if (content.mimeType === 'application/pdf') return 'PDF';
  return 'Документ Word';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'размер неизвестен';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
