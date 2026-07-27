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
import { colors, gradient, gradientText } from "../theme";
import { displayFont, monoFont } from "../fonts";

const CMD = "brew install --cask mac-closed-awake";
const URL = "onezion12344.github.io/mac-closed-awake";

// Scene: 300 frames (~33s–43s). Celebrate mascot, typewriter install, end card.
export const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const mascotIn = spring({
    frame: frame - 4,
    fps,
    config: { damping: 12, stiffness: 75, mass: 0.7 },
  });

  // Typewriter: one char every 2 frames, starting at frame 30
  const chars = Math.max(
    0,
    Math.min(CMD.length, Math.floor((frame - 30) / 2))
  );
  const typed = CMD.slice(0, chars);
  const cursorOn = Math.floor(frame / 15) % 2 === 0;

  const urlIn = interpolate(frame, [130, 155], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // End card takes over for the last ~3.5s
  const endIn = interpolate(frame, [190, 215], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const endIconScale = spring({
    frame: frame - 195,
    fps,
    config: { damping: 11, stiffness: 85, mass: 0.6 },
  });

  return (
    <AbsoluteFill style={{ background: colors.bg }}>
      {/* Main CTA layout */}
      <AbsoluteFill style={{ opacity: 1 - endIn }}>
        {/* Mascot celebrating */}
        <div
          style={{
            position: "absolute",
            left: 200,
            top: 240,
            width: 600,
            height: 600,
            borderRadius: 44,
            overflow: "hidden",
            transform: `scale(${mascotIn})`,
            boxShadow:
              "0 50px 140px rgba(0,0,0,0.55), 0 0 0 5px rgba(240,192,74,0.3)",
          }}
        >
          <Img
            src={staticFile("mascot-celebrate.png")}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>

        {/* Right column: terminal + URL */}
        <div style={{ position: "absolute", left: 900, top: 330, width: 840 }}>
          <div
            style={{
              fontFamily: displayFont,
              fontWeight: 700,
              fontSize: 64,
              color: colors.cream,
              letterSpacing: -1,
              marginBottom: 44,
            }}
          >
            Get it in one line.
          </div>

          {/* Terminal card */}
          <div
            style={{
              borderRadius: 20,
              background: "#0a1523",
              border: `2px solid ${colors.border}`,
              boxShadow: "0 30px 90px rgba(0,0,0,0.5)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "16px 20px",
                background: colors.surface,
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              {["#e8935a", "#f0c04a", "#3a8a8a"].map((c) => (
                <div
                  key={c}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: c,
                  }}
                />
              ))}
            </div>
            <div
              style={{
                padding: "34px 30px",
                fontFamily: monoFont,
                fontSize: 32,
                color: colors.cream,
              }}
            >
              <span style={{ color: colors.teal }}>$ </span>
              {typed}
              <span
                style={{
                  display: "inline-block",
                  width: 18,
                  height: 38,
                  marginLeft: 4,
                  verticalAlign: "middle",
                  background: cursorOn ? colors.gold : "transparent",
                }}
              />
            </div>
          </div>

          {/* URL */}
          <div
            style={{
              marginTop: 40,
              fontFamily: monoFont,
              fontSize: 30,
              color: colors.gold,
              opacity: urlIn,
              transform: `translateY(${(1 - urlIn) * 20}px)`,
            }}
          >
            → {URL}
          </div>
        </div>
      </AbsoluteFill>

      {/* End card */}
      <AbsoluteFill
        style={{
          opacity: endIn,
          background: colors.bg,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
        }}
      >
        <div
          style={{
            width: 220,
            height: 220,
            borderRadius: 52,
            overflow: "hidden",
            transform: `scale(${endIconScale})`,
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
            fontSize: 92,
            letterSpacing: -2,
            color: colors.cream,
          }}
        >
          MacClosedAwake
        </div>
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 48,
            ...gradientText,
          }}
        >
          Close the lid. Stay awake.
        </div>
        <div
          style={{
            fontFamily: monoFont,
            fontSize: 24,
            color: colors.muted,
          }}
        >
          {CMD}
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 8,
            background: gradient,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
