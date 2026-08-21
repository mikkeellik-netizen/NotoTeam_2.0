import { useEffect, useState } from 'react';
import { avatarApi } from '../api/avatar';
import type { User } from '../types';

type AvatarUser = Pick<User, 'id' | 'avatarUrl' | 'avatarStatus' | 'firstName' | 'lastName' | 'username'>;

type UserAvatarImageProps = {
  user?: AvatarUser;
  label: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  refreshKey?: number;
  className?: string;
};

export default function UserAvatarImage({
  user,
  label,
  size = 'sm',
  refreshKey = 0,
  className = '',
}: UserAvatarImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | undefined>();
  const dimension =
    size === 'lg'
      ? 'h-14 w-14 text-xl'
      : size === 'md'
        ? 'h-12 w-12 text-lg'
        : size === 'xs'
          ? 'h-6 w-6 text-xs'
          : 'h-10 w-10 text-base';

  useEffect(() => {
    let cancelled = false;
    let nextUrl: string | undefined;
    setObjectUrl(undefined);

    if (!user?.id || !user.avatarUrl || user.avatarStatus !== 'ready') return undefined;

    avatarApi
      .fetchObjectUrl(user.id)
      .then((url) => {
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        nextUrl = url;
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(undefined);
      });

    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [user?.id, user?.avatarUrl, user?.avatarStatus, refreshKey]);

  if (objectUrl) {
    return (
      <img
        src={objectUrl}
        alt=""
        className={`${dimension} shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div className={`${dimension} flex shrink-0 items-center justify-center rounded-full bg-[var(--tg-theme-button-color)] font-bold text-[var(--tg-theme-button-text-color)] ${className}`}>
      {label.slice(0, 1).toUpperCase() || '?'}
    </div>
  );
}
