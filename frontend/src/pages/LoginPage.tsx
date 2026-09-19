import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { getStoredSessionToken } from '../api/httpClient';

export default function LoginPage() {
  const requestCode = useAuthStore((state) => state.requestCode);
  const verifyCode = useAuthStore((state) => state.verifyCode);
  const loginLocalDev = useAuthStore((state) => state.loginLocalDev);
  const showLocalDevLogin = import.meta.env.DEV;

  const [step, setStep] = useState<'username' | 'code'>('username');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanUsername = username.trim().replace(/^@/, '');

  async function handleRequestCode() {
    if (!cleanUsername) {
      setError('Введите ваш Telegram-ник');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestCode(cleanUsername);
      setInfo(result.message);
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить код');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
      setError('Введите 6 символов: латинские буквы и цифры');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyCode(cleanUsername, normalizedCode);
      if (getStoredSessionToken()) window.location.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неверный код');
    } finally {
      setBusy(false);
    }
  }

  async function handleLocalDevLogin() {
    setBusy(true);
    setError(null);
    try {
      await loginLocalDev();
      if (getStoredSessionToken()) window.location.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--tg-theme-bg-color)] px-5">
      <div className="w-full max-w-sm rounded-[14px] bg-[var(--tg-theme-secondary-bg-color)] p-6 text-[var(--tg-theme-text-color)]">
        <h1 className="text-xl font-bold">Вход</h1>
        <p className="mt-2 text-sm text-[var(--tg-theme-hint-color)]">
          {step === 'username'
            ? 'Введите ваш Telegram-ник. Бот пришлёт одноразовый код для входа.'
            : `Введите код из 6 латинских букв и цифр, который бот отправил в Telegram${cleanUsername ? ` для @${cleanUsername}` : ''}.`}
        </p>

        {step === 'username' ? (
          <>
            <div className="mt-4 flex items-center rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3">
              <span className="text-[var(--tg-theme-hint-color)]">@</span>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRequestCode()}
                placeholder="ваш_ник"
                className="w-full bg-transparent px-2 py-3 outline-none"
              />
            </div>
            <button
              disabled={busy}
              onClick={handleRequestCode}
              className="mt-4 w-full rounded-[12px] bg-[var(--tg-theme-button-color)] px-5 py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
            >
              {busy ? 'Отправляем…' : 'Получить код'}
            </button>
            <p className="mt-4 text-xs text-[var(--tg-theme-hint-color)]">
              Сначала запустите бота в Telegram командой /start, иначе код не придёт.
            </p>
          </>
        ) : (
          <>
            <input
              autoFocus
              value={code}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              placeholder="A7K9Q2"
              className="mt-4 w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-3 py-3 text-center text-2xl outline-none"
            />
            <button
              disabled={busy}
              onClick={handleVerify}
              className="mt-4 w-full rounded-[12px] bg-[var(--tg-theme-button-color)] px-5 py-3 font-semibold text-[var(--tg-theme-button-text-color)] disabled:opacity-60"
            >
              {busy ? 'Проверяем…' : 'Войти'}
            </button>
            <button
              onClick={() => {
                setStep('username');
                setCode('');
                setError(null);
                setInfo(null);
              }}
              className="mt-3 w-full text-sm text-[var(--tg-theme-link-color,#3390ec)]"
            >
              Изменить ник
            </button>
          </>
        )}

        {info && step === 'code' && (
          <p className="mt-4 text-xs text-[var(--tg-theme-hint-color)]">{info}</p>
        )}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        {showLocalDevLogin && (
          <button
            disabled={busy}
            onClick={handleLocalDevLogin}
            className="mt-4 w-full rounded-[12px] bg-[var(--tg-theme-bg-color)] px-5 py-3 text-sm font-semibold text-[var(--tg-theme-text-color)] disabled:opacity-60"
          >
            Local User
          </button>
        )}
      </div>
    </div>
  );
}
