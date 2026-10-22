export type HomeHighlightDisplayMode = "single" | "rotate";

export function hasHomeHighlightNavigation(displayMode: HomeHighlightDisplayMode, campaignCount: number) {
  return displayMode === "rotate" && campaignCount > 1;
}

export function shouldAutoAdvanceHomeHighlight(input: {
  displayMode: HomeHighlightDisplayMode;
  campaignCount: number;
  paused: boolean;
  reducedMotion: boolean;
  pageVisible: boolean;
}) {
  return hasHomeHighlightNavigation(input.displayMode, input.campaignCount) &&
    !input.paused && !input.reducedMotion && input.pageVisible;
}

export function homeHighlightRotationDelay(intervalSeconds: 5 | 8 | 10) {
  return intervalSeconds * 1000;
}

export function nextHomeHighlightIndex(index: number, direction: -1 | 1, campaignCount: number) {
  if (campaignCount <= 0) return 0;
  return (index + direction + campaignCount) % campaignCount;
}
