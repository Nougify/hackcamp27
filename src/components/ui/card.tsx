import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl border border-line bg-surface p-5 ${className}`} {...props} />;
}

type Tone = "neutral" | "accent" | "warn" | "danger" | "ai";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  ai: "bg-ai-soft text-ai",
};

/** Small label. Colour is never the only signal (SPEC §12.5), so always pass text. */
export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
