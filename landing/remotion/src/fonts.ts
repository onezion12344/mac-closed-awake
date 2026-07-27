import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

const spaceGrotesk = loadSpaceGrotesk("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

const jetBrainsMono = loadJetBrainsMono("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
});

// Display font with system fallback stack
export const displayFont = `'${spaceGrotesk.fontFamily}', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif`;

// Mono font for tickers, labels, timer digits
export const monoFont = `'${jetBrainsMono.fontFamily}', 'SF Mono', Menlo, 'Courier New', monospace`;
