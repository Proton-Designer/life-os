import { Button } from "@/components/ui/button";

// Push notifications don't work on iOS PWAs unless installed to the home
// screen first — a real platform constraint, per spec, not a suggestion.
export function IosInstallPrompt({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Install Life OS to enable notifications</h1>
      <p className="text-sm text-muted-foreground">
        On iOS, push notifications (prayer times, check-ins) only work once Life OS is
        installed to your Home Screen. To install:
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Tap the <span className="font-medium text-foreground">Share</span> button in Safari
        </li>
        <li>
          Choose <span className="font-medium text-foreground">Add to Home Screen</span>
        </li>
        <li>Open Life OS from the Home Screen icon instead of Safari</li>
      </ol>
      <Button type="button" onClick={onContinue} variant="outline" className="self-start">
        Continue without notifications for now
      </Button>
    </div>
  );
}
