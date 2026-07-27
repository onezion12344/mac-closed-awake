import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, gradient } from "../theme";
import { displayFont, monoFont } from "../fonts";

const TICKER_TEXT =
  "AnyBuild, AnyRender, AnyDeploy — still awake · Lid closed. Mac awake. · ";

const TickerBand: React.FC<{
  bg: string;
  direction: 1 | -1;
  speed: number;
  rotate: number;
}> = ({ bg, direction, speed, rotate }) => {
  const frame = useCurrentFrame();
  const shift = ((frame * speed) % 900) * direction;
  return (
    <div
      style={{
        position: "absolute",
        left: -200,
        right: -200,
        height: 74,
        background: bg,
        transform: `rotate(${rotate}deg) translateX(${shift}px)`,
        display: "flex",
        alignItems: "center",
        overflow: "visible",
        whiteSpace: "nowrap",
        fontFamily: monoFont,
        fontWeight: 700,
        fontSize: 30,
        letterSpacing: 1,
        color: colors.bg,
      }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <span key={i} style={{ paddingRight: 24 }}>
          {TICKER_TEXT}
        </span>
      ))}
    </div>
  );
};

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const iconScale = spring({
    frame: frame - 8,
    fps,
    config: { damping: 11, stiffness: 90, mass: 0.6 },
  });
  const titleIn = spring({
    frame: frame - 20,
    fps,
    config: { damping: 14, stiffness: 80 },
  });
  const bandsIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [104, 120], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: fadeOut }}>
      {/* Ticker-tape marquee bands */}
      <div style={{ position: "absolute", inset: 0, opacity: bandsIn * 0.9 }}>
        <div style={{ position: "absolute", top: 90, left: 0, right: 0 }}>
          <TickerBand bg={colors.gold} direction={-1} speed={4} rotate={-2} />
        </div>
        <div style={{ position: "absolute", top: 880, left: 0, right: 0 }}>
          <TickerBand bg={colors.orange} direction={1} speed={5} rotate={1.5} />
        </div>
        <div style={{ position: "absolute", top: 985, left: 0, right: 0 }}>
          <TickerBand bg={colors.cream} direction={-1} speed={3} rotate={-1} />
        </div>
      </div>

      {/* Center lockup */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
        }}
      >
        <div
          style={{
            width: 240,
            height: 240,
            borderRadius: 56,
            overflow: "hidden",
            transform: `scale(${iconScale})`,
            boxShadow:
              "0 40px 120px rgba(0,0,0,0.6), 0 0 0 6px rgba(240,192,74,0.25)",
          }}
        >
          <Img
            src={staticFile("mascot-icon.png")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 110,
            color: colors.cream,
            letterSpacing: -3,
            opacity: titleIn,
            transform: `translateY(${(1 - titleIn) * 40}px)`,
          }}
        >
          Mac<span style={{ color: colors.gold }}>Closed</span>Awake
        </div>
        <div
          style={{
            fontFamily: monoFont,
            fontSize: 28,
            color: colors.muted,
            letterSpacing: 4,
            textTransform: "uppercase",
            opacity: interpolate(frame, [40, 60], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Lid closed. Mac awake.
        </div>
      </AbsoluteFill>

      {/* Subtle gradient accent bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 8,
          background: gradient,
          opacity: bandsIn,
        }}
      />
    </AbsoluteFill>
  );
};
