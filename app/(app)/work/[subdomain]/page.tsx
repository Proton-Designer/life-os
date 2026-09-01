import WorkPage from "../page";

// Composes the existing /work route unchanged (M5: adapt, don't rewrite) —
// its own actions.ts/targets-actions.ts/tasks-actions.ts imports resolve
// relative to where WorkPage is written, not here, so this changes nothing
// about how it fetches or mutates data, only which URL renders it. See
// [subdomain]/layout.tsx for the honest shared-data note this content
// currently needs (T-0002 not landed yet).
export default async function WorkSubdomainPage() {
  return <WorkPage />;
}
