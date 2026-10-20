import { SpeedTest } from "@/components/reader/speed-test";

// Static segment: wins over /read/[bookId]. The (reader) layout already requires a signed-in, onboarded user.
export default function SpeedTestPage() {
  return <SpeedTest />;
}
