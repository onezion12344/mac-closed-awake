import type { CSSProperties } from "react";

// Design tokens for MacClosedAwake brand
export const colors = {
  bg: "#0d1b2a",
  surface: "#13233a",
  card: "#162236",
  border: "#1e3050",
  cream: "#f5eeda",
  orange: "#e8935a",
  gold: "#f0c04a",
  teal: "#3a8a8a",
  muted: "#8a9ab0",
};

export const gradient = "linear-gradient(135deg, #f0c04a, #e8935a)";

// Helper for gradient text (Space Grotesk headlines)
export const gradientText: CSSProperties = {
  background: gradient,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
  color: "transparent",
};
