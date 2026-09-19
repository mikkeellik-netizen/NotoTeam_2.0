import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { getStoredSessionToken } from '../api/httpClient';
import { Button, Surface, TextField } from '../components/ui';

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
    <div className="flex h-full items-center justify-center bg-[var(--nt-color-canvas)] px-5">
      <Surface tone="raised" padding="lg" className="w-full max-w-sm">
        <h1 className="text-xl font-bold">Вход</h1>
        <p className="mt-2 text-sm text-[var(--nt-color-text-muted)]">
          {step === 'username'
            ? 'Введите ваш Telegram-ник. Бот пришлёт одноразовый код для входа.'
            : `Введите код из 6 латинских букв и цифр, который бот отправил в Telegram${cleanUsername ? ` для @${cleanUsername}` : ''}.`}
        </p>

        {step === 'username' ? (
          <>
            <TextField
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRequestCode()}
              placeholder="ваш_ник"
              startAdornment={<span>@</span>}
              containerClassName="mt-4"
            />
            <Button
              block
              loading={busy}
              onClick={handleRequestCode}
              className="mt-4"
            >
              {busy ? 'Отправляем…' : 'Получить код'}
            </Button>
            <p className="mt-4 text-xs text-[var(--nt-color-text-muted)]">
              Сначала запустите бота в Telegram командой /start, иначе код не придёт.
            </p>
          </>
        ) : (
          <>
            <TextField
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
              containerClassName="mt-4"
              className="text-center text-2xl tracking-[0.16em]"
            />
            <Button
              block
              loading={busy}
              onClick={handleVerify}
              className="mt-4"
            >
              {busy ? 'Проверяем…' : 'Войти'}
            </Button>
            <Button
              block
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep('username');
                setCode('');
                setError(null);
                setInfo(null);
              }}
              className="mt-3"
            >
              Изменить ник
            </Button>
          </>
        )}

        {info && step === 'code' && (
          <p className="mt-4 text-xs text-[var(--nt-color-text-muted)]">{info}</p>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-[var(--nt-color-danger)]">{error}</p>}
        {showLocalDevLogin && (
          <Button
            block
            variant="secondary"
            loading={busy}
            onClick={handleLocalDevLogin}
            className="mt-4"
          >
            Local User
          </Button>
        )}
      </Surface>
    </div>
  );
}
