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

const CIRCUMFERENCE = 2 * Math.PI * 150;

const PRESETS = ["1h", "2h", "4h", "8h", "∞"];

// Scene: 270 frames (~24s–33s). Timer presets + animated ring + mascot.
export const Timer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headlineIn = spring({
    frame: frame - 4,
    fps,
    config: { damping: 14, stiffness: 80 },
  });

  // Ring fills as time counts down 2:00:00 -> 1:23:45 for flavor
  const ringProgress = interpolate(frame, [30, 240], [0, 0.68], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const totalSeconds = interpolate(frame, [30, 240], [7200, 5025], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const timerText = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  const mascotIn = spring({
    frame: frame - 30,
    fps,
    config: { damping: 13, stiffness: 65, mass: 0.9 },
  });

  const fadeOut = interpolate(frame, [254, 270], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: fadeOut }}>
      {/* Headline */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 100,
          textAlign: "center",
          fontFamily: displayFont,
          fontWeight: 700,
          fontSize: 80,
          color: colors.cream,
          letterSpacing: -1,
          opacity: headlineIn,
          transform: `translateY(${(1 - headlineIn) * 30}px)`,
        }}
      >
        One click. Or pick a timer.
      </div>

      {/* Preset chips popping in sequence */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 250,
          display: "flex",
          justifyContent: "center",
          gap: 26,
        }}
      >
        {PRESETS.map((label, i) => {
          const pop = spring({
            frame: frame - (40 + i * 22),
            fps,
            config: { damping: 10, stiffness: 120, mass: 0.5 },
          });
          const active = label === "∞";
          return (
            <div
              key={label}
              style={{
                transform: `scale(${pop})`,
                padding: "22px 46px",
                borderRadius: 22,
                fontFamily: monoFont,
                fontWeight: 700,
                fontSize: 40,
                background: active ? gradient : colors.card,
                color: active ? colors.bg : colors.cream,
                border: active
                  ? "2px solid rgba(240,192,74,0.6)"
                  : `2px solid ${colors.border}`,
                boxShadow: active
                  ? "0 16px 50px rgba(240,192,74,0.3)"
                  : "0 10px 30px rgba(0,0,0,0.35)",
              }}
            >
              {label}
            </div>
          );
        })}
      </div>

      {/* Timer ring */}
      <div
        style={{
          position: "absolute",
          left: 480,
          top: 440,
          width: 480,
          height: 480,
        }}
      >
        <svg
          viewBox="0 0 340 340"
          width={480}
          height={480}
          style={{ transform: "rotate(-90deg)" }}
        >
          <defs>
            <linearGradient id="timerRing" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.gold} />
              <stop offset="100%" stopColor={colors.orange} />
            </linearGradient>
          </defs>
          <circle
            cx="170"
            cy="170"
            r="150"
            fill="none"
            stroke={colors.border}
            strokeWidth="14"
          />
          <circle
            cx="170"
            cy="170"
            r="150"
            fill="none"
            stroke="url(#timerRing)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ringProgress)}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: monoFont,
              fontWeight: 500,
              fontSize: 78,
              color: colors.cream,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {timerText}
          </div>
          <div
            style={{
              fontFamily: monoFont,
              fontSize: 20,
              color: colors.muted,
              letterSpacing: 4,
              textTransform: "uppercase",
              marginTop: 6,
            }}
          >
            remaining
          </div>
        </div>
      </div>

      {/* Caption under the ring */}
      <div
        style={{
          position: "absolute",
          left: 300,
          top: 950,
          width: 840,
          textAlign: "center",
          fontFamily: monoFont,
          fontSize: 24,
          color: colors.muted,
          opacity: interpolate(frame, [150, 180], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        When time's up, your Mac sleeps normally again.
      </div>

      {/* Mascot on the side */}
      <div
        style={{
          position: "absolute",
          right: 220,
          top: 430,
          width: 520,
          height: 520,
          borderRadius: 40,
          overflow: "hidden",
          transform: `scale(${mascotIn})`,
          boxShadow: "0 40px 120px rgba(0,0,0,0.55), 0 0 0 4px rgba(58,138,138,0.35)",
        }}
      >
        <Img
          src={staticFile("mascot-awake.png")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    </AbsoluteFill>
  );
};
