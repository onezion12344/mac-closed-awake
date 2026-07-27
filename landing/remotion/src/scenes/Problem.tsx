import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { colors } from "../theme";
import { displayFont, monoFont } from "../fonts";

// Scene: 240 frames (~4s–12s). Lid closes, everything dies.
const BEATS = [
  { text: "Builds die.", at: 66 },
  { text: "Downloads freeze.", at: 108 },
  { text: "Agents sleep.", at: 150 },
];

const DyingBar: React.FC<{
  label: string;
  top: number;
  dieAt: number;
  progress: number;
}> = ({ label, top, dieAt, progress }) => {
  const frame = useCurrentFrame();
  const alive = frame < dieAt;
  const opacity = interpolate(frame, [dieAt, dieAt + 20], [1, 0.55], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        opacity,
        fontFamily: monoFont,
        fontSize: 22,
        color: alive ? colors.muted : "#6d7d95",
      }}
    >
      <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span>{alive ? `${Math.round(progress * 100)}%` : "— interrupted"}</span>
      </div>
      <div
        style={{
          height: 10,
          borderRadius: 5,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: alive ? colors.teal : "#4d5d78",
          }}
        />
      </div>
    </div>
  );
};

export const Problem: React.FC = () => {
  const frame = useCurrentFrame();

  // Lid closing: a MacBook silhouette whose screen rotates shut (frames 0–55)
  const lidAngle = interpolate(frame, [5, 55], [0, 88], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dimming = interpolate(frame, [30, 60], [0, 0.28], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Progress bars freeze right after the lid closes
  const barProgress = interpolate(frame, [0, 58], [0.42, 0.63], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const fadeOut = interpolate(frame, [224, 240], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "#0a1420", opacity: fadeOut }}>
      {/* Left: laptop closing */}
      <div
        style={{
          position: "absolute",
          left: 200,
          top: 340,
          width: 560,
          perspective: 1200,
        }}
      >
        {/* Screen half */}
        <div
          style={{
            width: 560,
            height: 340,
            borderRadius: "14px 14px 0 0",
            background: `linear-gradient(180deg, ${colors.surface}, ${colors.card})`,
            border: `2px solid ${colors.border}`,
            borderBottom: "none",
            transformOrigin: "bottom center",
            transform: `rotateX(${lidAngle}deg)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontFamily: monoFont,
              fontSize: 20,
              color: colors.teal,
              opacity: 1 - lidAngle / 88,
              lineHeight: 1.8,
            }}
          >
            $ npm run build{"\n"}
            <span style={{ color: colors.muted }}>compiling… 63%</span>
          </div>
          {/* screen dimming overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#000",
              opacity: lidAngle / 110,
            }}
          />
        </div>
        {/* Base half */}
        <div
          style={{
            width: 560,
            height: 22,
            borderRadius: "0 0 16px 16px",
            background: `linear-gradient(180deg, #24374f, ${colors.surface})`,
            border: `2px solid ${colors.border}`,
          }}
        />
      </div>

      {/* Right: dying progress bars */}
      <div
        style={{
          position: "absolute",
          left: 1030,
          top: 300,
          width: 640,
          height: 320,
        }}
      >
        <DyingBar label="xcodebuild · MyApp.xcarchive" top={0} dieAt={62} progress={barProgress} />
        <DyingBar label="curl · dataset.tar.gz (4.2 GB)" top={110} dieAt={70} progress={barProgress * 0.7} />
        <DyingBar label="agent · refactoring 214 files" top={220} dieAt={78} progress={barProgress * 0.5} />
      </div>

      {/* Beat lines */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 760,
          display: "flex",
          justifyContent: "center",
          gap: 70,
        }}
      >
        {BEATS.map(({ text, at }) => {
          const o = interpolate(frame, [at, at + 16], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const y = interpolate(frame, [at, at + 16], [24, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={text}
              style={{
                fontFamily: monoFont,
                fontWeight: 700,
                fontSize: 46,
                color: "#aebccf",
                opacity: o,
                transform: `translateY(${y}px)`,
              }}
            >
              {text}
            </div>
          );
        })}
      </div>

      {/* Headline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 150,
          textAlign: "center",
          fontFamily: displayFont,
          fontWeight: 700,
          fontSize: 64,
          color: colors.cream,
          opacity: interpolate(frame, [10, 30], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        You close the lid… and everything stops.
      </div>

      {/* Global darkening as the lid shuts */}
      <AbsoluteFill style={{ background: "#000", opacity: dimming, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
