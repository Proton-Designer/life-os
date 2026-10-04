"use client";

import { Component, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/shell/error-state";

type Caught = Error & { digest?: string };

// React error boundaries must be classes; this one only holds the caught error.
class Boundary extends Component<{ children: ReactNode; label: string; onRetry: () => void }, { error: Caught | null }> {
  state: { error: Caught | null } = { error: null };
  static getDerivedStateFromError(error: Caught) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorState
        error={error}
        title={`${this.props.label} didn't load`}
        body="The rest of the page is fine. Try again."
        showHomeLink={false}
        retry={() => {
          this.setState({ error: null });
          this.props.onRetry();
        }}
      />
    );
  }
}

/**
 * NAV-01c: wrap ONE streamed module (around its <Suspense>) so a failure shows a small inline card
 * for that module instead of taking the whole page to app/(app)/error.tsx. "Try again" re-renders the
 * page's server data (router.refresh) and clears the card. Only `children` and a string cross from the
 * server, so no function props.
 */
export function InlineErrorBoundary({ label, children }: { label: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Boundary label={label} onRetry={() => router.refresh()}>
      {children}
    </Boundary>
  );
}
