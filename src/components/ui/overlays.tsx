'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export function ToastHost({ children }: { children?: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onToast = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      setTimeout(() => setMessage(null), 4000);
    };
    window.addEventListener('mise:toast', onToast);
    return () => window.removeEventListener('mise:toast', onToast);
  }, []);

  return (
    <>
      {children}
      {message && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-surface-raised px-5 py-3 text-sm shadow-lg">
          {message}
        </div>
      )}
    </>
  );
}

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent('mise:toast', { detail: message }));
}

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg bg-surface-raised px-3 py-2 text-sm">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
