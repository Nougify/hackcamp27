import type { ReactNode } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex min-h-14 items-center justify-center rounded-xl px-6 text-base font-semibold transition-opacity disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-accent text-accent-contrast'
      : variant === 'danger'
        ? 'bg-danger text-white'
        : 'bg-surface-raised text-text';
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border bg-surface p-5 ${className}`}>{children}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'ai' }) {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-raised text-text-muted',
    good: 'bg-accent text-accent-contrast',
    warn: 'bg-warning text-black',
    bad: 'bg-danger text-white',
    ai: 'bg-white text-black',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
