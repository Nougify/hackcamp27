'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserProfile } from '@/contracts/domain';
import { Button, Card, Dialog, useToast } from '@/components/ui';
import { GestureSettings, loadPrefs, savePrefs, DEFAULT_PREFS, type CookPrefs } from '@/features/gesture';
import { meApi } from '@/features/pantry/api';
import { ProfileForm } from '@/features/pantry/ProfileForm';

const CONFIRM_WORD = 'delete';

export function SettingsClient({ profile }: { profile: UserProfile }) {
  const router = useRouter();
  const toast = useToast();
  const [gestureOpen, setGestureOpen] = useState(false);
  const [prefs, setPrefs] = useState<CookPrefs>(DEFAULT_PREFS);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);


  async function deleteEverything() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await meApi.deleteAll();
      // /auth/logout is the Auth0 SDK route, not a Next page: it needs a full browser navigation.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- SDK route, not a page
      window.location.href = '/auth/logout';
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Could not delete your data.');
      setDeleting(false);
    }
  }

  return (
    <div className="mt-8 grid gap-8">
      <Card>
        <h2 className="mb-5 font-display text-xl font-semibold">Profile and food</h2>
        <ProfileForm
          initial={profile}
          mode="settings"
          onSaved={() => {
            toast('Settings saved');
            router.refresh();
          }}
        />
      </Card>

      <Card>
        <h2 className="font-display text-xl font-semibold">Cook mode</h2>
        <p className="mt-1 text-sm text-muted">Gesture sensitivity, hold time and read-aloud. Saved on this device.</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => {
            setPrefs(loadPrefs()); // cook prefs live in localStorage (Jerry's decision)
            setGestureOpen(true);
          }}
        >
          Gesture and voice settings
        </Button>
        <GestureSettings
          open={gestureOpen}
          onClose={() => setGestureOpen(false)}
          prefs={prefs}
          onChange={(p) => {
            setPrefs(p);
            savePrefs(p);
          }}
        />
      </Card>

      <Card>
        <h2 className="font-display text-xl font-semibold">Account</h2>
        <p className="mt-1 text-sm text-muted">{profile.email ?? 'Signed in'}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {/* Plain <a>: the SDK route must not be prefetched or client-routed. */}
          <a href="/auth/logout" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold">
            Log out
          </a>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            Delete my data
          </Button>
        </div>
      </Card>

      <Dialog open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} title="Delete all your data?">
        <div className="grid gap-4">
          <p>
            This permanently deletes your pantry, saved recipes, cooking sessions and meal history, then signs you out.
            It can&apos;t be undone.
          </p>
          <label className="grid gap-1 text-sm">
            Type <strong>{CONFIRM_WORD}</strong> to confirm
            <input
              className="min-h-11 rounded-xl border border-line bg-surface px-3"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </label>
          {deleteError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              {deleteError}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="danger" disabled={confirmText.trim().toLowerCase() !== CONFIRM_WORD || deleting} onClick={deleteEverything}>
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
            <Button variant="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
