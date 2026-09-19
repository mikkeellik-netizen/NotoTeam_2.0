import { useRef, useState, type DragEvent } from 'react';
import type { ProjectFileRecord } from '../../types';
import {
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_MAX_BYTES,
  uploadProjectFile,
  type ProjectFileUploadMode,
} from '../../api/projectFiles';

type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: 'ready' | 'uploading' | 'done' | 'error';
  error?: string;
};

interface Props {
  projectId: string;
  mode: ProjectFileUploadMode;
  onUploaded: (files: ProjectFileRecord[]) => void;
  onClose: () => void;
}

const allowedExtensions = new Set(PROJECT_FILE_ACCEPT.split(','));

export default function FileUploadModal({ projectId, mode, onUploaded, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const addFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    const next: UploadItem[] = [];
    const errors: string[] = [];
    const room = Math.max(0, 10 - items.length);

    incoming.slice(0, room).forEach((file, index) => {
      const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
      if (!allowedExtensions.has(extension)) {
        errors.push(`${file.name}: формат не поддерживается`);
        return;
      }
      if (file.size === 0) {
        errors.push(`${file.name}: пустой файл`);
        return;
      }
      if (file.size > PROJECT_FILE_MAX_BYTES) {
        errors.push(`${file.name}: больше 25 МБ`);
        return;
      }
      next.push({ id: `${Date.now()}-${index}-${file.name}`, file, progress: 0, status: 'ready' });
    });

    if (incoming.length > room) errors.push('За один раз можно загрузить не более 10 файлов');
    setItems((current) => [...current, ...next]);
    setMessage(errors.join('\n'));
  };

  const updateItem = (id: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const startUpload = async () => {
    const pending = items.filter((item) => item.status !== 'done');
    if (!pending.length || busy) return;
    setBusy(true);
    setMessage('');
    const uploaded: ProjectFileRecord[] = [];

    for (const item of pending) {
      updateItem(item.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const record = await uploadProjectFile(projectId, item.file, mode, (progress) => {
          updateItem(item.id, { progress });
        });
        uploaded.push(record);
        updateItem(item.id, { status: 'done', progress: 100 });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Ошибка загрузки';
        updateItem(item.id, { status: 'error', error: errorMessage });
      }
    }

    if (uploaded.length) onUploaded(uploaded);
    const failed = pending.length - uploaded.length;
    setBusy(false);
    if (failed === 0) onClose();
    else setMessage(`Загружено: ${uploaded.length}. Не удалось: ${failed}.`);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-black/55 p-3 sm:items-center sm:justify-center" onClick={() => !busy && onClose()}>
      <section
        className="w-full max-w-lg rounded-[8px] bg-[var(--tg-theme-bg-color)] p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[var(--tg-theme-text-color)]">Загрузить файлы</h3>
            <p className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">Фото, Word, PDF и аудио. До 25 МБ на файл.</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-8 w-8 shrink-0 rounded-full bg-[var(--tg-theme-secondary-bg-color)] text-lg text-[var(--tg-theme-text-color)] disabled:opacity-40"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={PROJECT_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent<HTMLButtonElement>) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          className={`flex min-h-28 w-full flex-col items-center justify-center rounded-[8px] border border-dashed px-4 py-5 text-center transition-colors ${
            dragging
              ? 'border-[var(--tg-theme-button-color)] bg-[var(--tg-theme-button-color)]/10'
              : 'border-[var(--tg-theme-hint-color)] bg-[var(--tg-theme-secondary-bg-color)]'
          } disabled:opacity-50`}
        >
          <span className="text-2xl">↑</span>
          <span className="mt-1 text-sm font-semibold text-[var(--tg-theme-text-color)]">Выбрать файлы</span>
          <span className="mt-1 text-xs text-[var(--tg-theme-hint-color)]">или перетащить сюда</span>
        </button>

        {items.length > 0 && (
          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--tg-theme-text-color)]">{item.file.name}</p>
                    <p className={`text-xs ${item.status === 'error' ? 'text-red-400' : 'text-[var(--tg-theme-hint-color)]'}`}>
                      {item.error || `${formatBytes(item.file.size)} · ${uploadStatus(item.status)}`}
                    </p>
                  </div>
                  {!busy && item.status !== 'done' && (
                    <button
                      type="button"
                      onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}
                      className="h-7 w-7 rounded-full text-red-400"
                      aria-label={`Убрать ${item.file.name}`}
                    >
                      ×
                    </button>
                  )}
                </div>
                {(item.status === 'uploading' || item.status === 'done') && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--tg-theme-bg-color)]">
                    <div className="h-full bg-[var(--tg-theme-button-color)] transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {message && <p className="mt-3 whitespace-pre-line text-sm text-amber-400">{message}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-[8px] bg-[var(--tg-theme-secondary-bg-color)] px-4 py-3 text-sm font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-40"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={busy || !items.some((item) => item.status !== 'done')}
            onClick={startUpload}
            className="rounded-[8px] bg-[var(--tg-theme-button-color)] px-4 py-3 text-sm font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-45"
          >
            {busy ? 'Загрузка…' : `Загрузить${items.length ? ` (${items.filter((item) => item.status !== 'done').length})` : ''}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function uploadStatus(status: UploadItem['status']) {
  if (status === 'uploading') return 'загрузка';
  if (status === 'done') return 'готово';
  if (status === 'error') return 'ошибка';
  return 'готов к загрузке';
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
