import { BookOpen } from "lucide-react";
import { PageContainer } from "@/components/shell/page-container";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";

// An honest empty state, not a fake one (the Lead's explicit instruction):
// ULM's ingestion pipeline and lesson library aren't merged yet. No fake
// progress bars, no invented stats — just what's true today and what's
// coming, with a real working action (Home), not a dead-end button.
export function SelfMasteryPlaceholder() {
  return (
    <PageContainer>
      <PageHeader title="Self-Mastery" description="Reading, learning, spaced review." />
      <Panel title="Coming soon">
        <EmptyState
          icon={BookOpen}
          message="Self-Mastery isn't built into Life OS yet. Once it lands, uploading a book here will turn it into a few minutes of daily recall — spaced review across everything you're reading, not just one book at a time."
          action={{ label: "Back to Home", href: "/" }}
        />
      </Panel>
    </PageContainer>
  );
}
