"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteMyAccount } from "@/app/(app)/settings/account-actions";

/**
 * #32's confirmation flow — deliberately not a bare button: the destructive
 * action stays disabled until the user retypes "DELETE" exactly, and the
 * same phrase is re-checked server-side in deleteMyAccount (a client-only
 * gate is not real confirmation for something unrecoverable).
 *
 * Imports the server action directly (AGENTS.md's Server->Client boundary
 * rule: never pass a function as a PROP from a Server Component) — same
 * idiom as this exact settings-form.tsx importing `signOut` for its own
 * Sign out button.
 */
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canConfirm = confirmText === "DELETE" && !isPending;

  function handleOpenChange(next: boolean) {
    if (isPending) return; // never let the dialog close mid-delete
    setOpen(next);
    if (!next) {
      setConfirmText("");
      setError(null);
    }
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteMyAccount(confirmText);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Full navigation, not a client-side route change — clears every
      // provider's in-memory state (LockInOverlay, AllocationQueue, etc.)
      // rather than leaving them holding data for an account that no
      // longer exists server-side.
      window.location.href = "/login";
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-destructive">Danger zone</p>
      <p className="text-xs text-muted-foreground">
        Permanently deletes your account and every row tied to it — tasks, sessions, habits, grades, your
        Self-Mastery library, everything. This cannot be undone.
      </p>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
            Delete account
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account and everything in it. There is no undo. Type DELETE below to
              confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm account deletion"
            autoFocus
            disabled={isPending}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={!canConfirm} onClick={handleDelete}>
              {isPending ? "Deleting…" : "Permanently delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
