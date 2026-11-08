"use client";

import { useState } from "react";
import { Badge, Card, buttonClass } from "@/components/ui";
import type { StatusResult, CheckStatus } from "@/server/status";

const STATUS_TEXT: Record<CheckStatus, string> = {
  up: "Up",
  down: "Down",
  configured: "Configured",
  not_configured: "Not configured",
};

const STATUS_TONE: Record<CheckStatus, "accent" | "danger" | "warn"> = {
  up: "accent",
  down: "danger",
  configured: "accent",
  not_configured: "warn",
};

export function StatusClient({ initial }: { initial: StatusResult }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Status check failed");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status check failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Checked {new Date(data.checkedAt).toLocaleTimeString()}</p>
        <button type="button" onClick={refresh} disabled={loading} className={buttonClass("secondary", "md")}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <ul className="mt-4 flex flex-col gap-3">
        {data.checks.map((check) => (
          <li key={check.name}>
            <Card className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold">{check.label}</p>
                {check.detail && <p className="mt-1 text-xs text-muted">{check.detail}</p>}
              </div>
              <div className="flex items-center gap-3">
                {check.ms != null && <span className="text-xs text-muted">{check.ms} ms</span>}
                <Badge tone={STATUS_TONE[check.status]}>{STATUS_TEXT[check.status]}</Badge>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
