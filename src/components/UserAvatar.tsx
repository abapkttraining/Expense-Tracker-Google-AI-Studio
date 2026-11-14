import { useState } from 'react';

interface UserAvatarProps {
  name: string;
  photoURL?: string;
  size?: 'xs' | 'sm' | 'md';
}

export function UserAvatar({ name, photoURL, size = 'sm' }: UserAvatarProps) {
  const [failed, setFailed] = useState(false);

  const initials = (name || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const sizeClass =
    size === 'xs'
      ? 'w-6 h-6 text-[10px]'
      : size === 'md'
        ? 'w-9 h-9 text-xs'
        : 'w-7 h-7 text-[11px]';

  if (photoURL && !failed) {
    return (
      <img
        src={photoURL}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${sizeClass} rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100 dark:bg-slate-800`}
      />
    );
  }

  return (
    <span
      aria-label={name}
      className={`${sizeClass} rounded-full inline-flex items-center justify-center font-semibold bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800 shrink-0 select-none`}
    >
      {initials || 'U'}
    </span>
  );
}
