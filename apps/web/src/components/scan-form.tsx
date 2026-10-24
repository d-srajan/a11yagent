import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Phase 0: visual only. Phase 4 wires this to POST /api/scans with Turnstile.
export function ScanForm() {
  return (
    <form className="mt-8" aria-describedby="scan-status">
      <label htmlFor="scan-url" className="block text-sm font-medium">
        Website URL
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <Input
          id="scan-url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://example.com"
          required
        />
        <Button type="submit" size="lg" disabled>
          Scan site
        </Button>
      </div>
      <p id="scan-status" className="mt-2 text-sm text-muted-foreground">
        Scanning is not open yet. Check back soon.
      </p>
    </form>
  );
}
