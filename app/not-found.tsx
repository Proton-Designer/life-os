import { NotFoundCard } from "@/components/shell/not-found-card";

// NAV-01c: URLs that match no route at all (outside the app shell). Renders inside the root layout.
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <NotFoundCard />
    </main>
  );
}
