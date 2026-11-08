"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native <dialog> modal. `open` is the source of truth; onClose fires only for Esc or a backdrop click. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault(); // Esc: let the parent decide via `open`
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={`m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink ${className}`}
    >
      <div className="p-6">
        <h2 className="mb-4 font-display text-2xl font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
