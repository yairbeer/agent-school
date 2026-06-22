import { useRef } from "react";

/**
 * Hook for scrolling to transcript entries (for review findings)
 */
export function useTranscriptScrollTo() {
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToEntry = (entryId: string) => {
    const element = containerRef.current?.querySelector(`[data-entry-id="${entryId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return { containerRef, scrollToEntry };
}
