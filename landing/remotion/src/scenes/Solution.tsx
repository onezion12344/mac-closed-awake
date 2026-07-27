import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, gradientText } from "../theme";
import { displayFont, monoFont } from "../fonts";
import { Demo } from "../Demo";

// Scene: 360 frames (~12s–24s). Mascot hero + headline, then app UI mock.
export const Solution: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardIn = spring({
    frame: frame - 6,
    fps,
    config: { damping: 12, stiffness: 70, mass: 0.8 },
  });
  const headlineIn = spring({
    frame: frame - 24,
    fps,
    config: { damping: 14, stiffness: 80 },
  });
  const subIn = interpolate(frame, [50, 72], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // App mock slides in from the right at ~5s into the scene
  const mockIn = spring({
    frame: frame - 150,
    fps,
    config: { damping: 15, stiffness: 60, mass: 0.9 },
  });

  // Mascot card shifts left to make room for the mock
  const shiftLeft = interpolate(mockIn, [0, 1], [0, -330]);

  const fadeOut = interpolate(frame, [344, 360], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: fadeOut }}>
      {/* Warm background glow */}
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 1100,
          height: 900,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(240,192,74,0.10) 0%, transparent 60%)",
          filter: "blur(60px)",
        }}
      />

      {/* Headline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 110,
          textAlign: "center",
          opacity: headlineIn,
          transform: `translateY(${(1 - headlineIn) * 40}px)`,
        }}
      >
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 700,
            fontSize: 96,
            letterSpacing: -2,
            ...gradientText,
          }}
        >
          Close the lid. Stay awake.
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: monoFont,
            fontSize: 26,
            color: colors.muted,
            opacity: subIn,
          }}
        >
          No external display. No tricks. Fully awake, lid closed.
        </div>
      </div>

      {/* Mascot in cream rounded card */}
      <div
        style={{
          position: "absolute",
          top: 340,
          left: "50%",
          transform: `translateX(calc(-50% + ${shiftLeft}px)) scale(${cardIn})`,
          width: 560,
          height: 620,
          borderRadius: 44,
          background: colors.cream,
          boxShadow: "0 50px 140px rgba(0,0,0,0.55)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Img
          src={staticFile("mascot-hero.png")}
          style={{ width: "108%", height: "108%", objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 22,
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: monoFont,
            fontWeight: 700,
            fontSize: 20,
            letterSpacing: 2,
            color: colors.cream,
            textShadow: "0 2px 12px rgba(0,0,0,0.7)",
          }}
        >
          MACCLOSEDAWAKE
        </div>
      </div>

      {/* Recolored app UI mock in a device-ish frame */}
      <Sequence from={150} layout="none">
        <div
          style={{
            position: "absolute",
            top: 330,
            left: "50%",
            transform: `translateX(calc(-50% + 350px + ${(1 - mockIn) * 500}px))`,
            opacity: mockIn,
            width: 440,
            height: 540,
            borderRadius: 32,
            border: `2px solid ${colors.border}`,
            background: colors.surface,
            boxShadow: "0 50px 140px rgba(0,0,0,0.55)",
            padding: 18,
          }}
        >
          <div
            style={{
              position: "relative",
              width: 400,
              height: 500,
              borderRadius: 20,
              overflow: "hidden",
            }}
          >
            <Demo />
          </div>
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
