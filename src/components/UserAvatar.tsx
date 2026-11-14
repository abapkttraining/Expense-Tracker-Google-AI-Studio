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
        className={`${sizeClass} rounded-full object-cover border border-slate-200 shrink-0 bg-slate-100`}
      />
    );
  }

  return (
    <span
      aria-label={name}
      className={`${sizeClass} rounded-full inline-flex items-center justify-center font-semibold bg-teal-50 text-teal-800 border border-teal-200 shrink-0 select-none`}
    >
      {initials || 'U'}
    </span>
  );
}
