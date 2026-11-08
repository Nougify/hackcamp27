'use client';

import { useRef, useState } from 'react';
import type { RecipeSearchEvent, RecipeSearchRequest } from '@/contracts/api';
import type { RecipeCandidate } from '@/contracts/domain';
import { Button, Card } from '@/components/ui';
import { RecipeCard } from './RecipeCard';

interface SearchState {
  running: boolean;
  status: string | null;
  suggestionsHtml: string | null;
  candidates: RecipeCandidate[];
  excludedCount: number;
  done: boolean;
  error: string | null;
}

const INITIAL: SearchState = {
  running: false,
  status: null,
  suggestionsHtml: null,
  candidates: [],
  excludedCount: 0,
  done: false,
  error: null,
};

export function SearchStream() {
  const [freeText, setFreeText] = useState('');
  const [state, setState] = useState<SearchState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const search = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL, running: true, status: 'Starting search…' });

    const body: RecipeSearchRequest = { freeText: freeText.trim() || undefined };
    let res: Response;
    try {
      res = await fetch('/api/recipes/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setState((s) => ({ ...s, running: false, error: 'Search request failed. Check your connection.' }));
      return;
    }
    if (!res.ok || !res.body) {
      const detail = await res.json().catch(() => null);
      setState((s) => ({
        ...s,
        running: false,
        error: detail?.error?.message ?? `Search failed (${res.status}).`,
      }));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          handleEvent(JSON.parse(line) as RecipeSearchEvent);
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setState((s) => ({ ...s, running: false, error: 'The connection dropped mid-search.' }));
      }
    }
  };

  const handleEvent = (event: RecipeSearchEvent) => {
    switch (event.type) {
      case 'status':
        setState((s) => ({ ...s, status: event.message }));
        break;
      case 'search_suggestions':
        setState((s) => ({ ...s, suggestionsHtml: event.html }));
        break;
      case 'candidate':
        setState((s) => ({ ...s, candidates: [...s.candidates, event.candidate] }));
        break;
      case 'excluded':
        setState((s) => ({ ...s, excludedCount: s.excludedCount + 1 }));
        break;
      case 'done':
        setState((s) => ({ ...s, running: false, done: true, status: null }));
        break;
      case 'error':
        setState((s) => ({ ...s, running: false, error: event.error.message }));
        break;
    }
  };

  const sorted = [...state.candidates].sort((a, b) => b.score.score - a.score.score);

  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input
          type="text"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="quick dinner… (optional)"
          maxLength={100}
          aria-label="Recipe theme"
          className="min-h-14 flex-1 rounded-xl border border-line bg-surface px-4 text-base"
        />
        <Button type="submit" disabled={state.running}>
          {state.running ? 'Searching…' : 'Find recipes'}
        </Button>
      </form>

      {state.status && (
        <p role="status" className="mt-4 text-sm text-muted">
          {state.status}
        </p>
      )}
      {state.error && (
        <Card className="mt-4">
          <p>{state.error}</p>
          <Button variant="secondary" className="mt-3" onClick={search}>
            Try again
          </Button>
        </Card>
      )}

      {state.suggestionsHtml && (
        <iframe
          title="Related searches"
          srcDoc={state.suggestionsHtml}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="mt-4 h-24 w-full rounded-xl border border-line bg-surface"
        />
      )}

      <div className="mt-4 flex flex-col gap-3">
        {sorted.map((c) => (
          <RecipeCard key={c.recipeId} candidate={c} />
        ))}
      </div>

      {state.done && sorted.length === 0 && !state.error && (
        <Card className="mt-4">
          <p className="font-semibold">No recipes matched your pantry.</p>
          <p className="mt-1 text-sm text-muted">Try different ingredients or add more to your pantry.</p>
        </Card>
      )}
      {state.done && state.excludedCount > 0 && (
        <p className="mt-3 text-xs text-muted">
          {state.excludedCount} result{state.excludedCount === 1 ? '' : 's'} hidden (diet filters, unreadable pages, or duplicates).
        </p>
      )}
    </div>
  );
}
