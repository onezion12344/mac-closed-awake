import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";
import { colors, gradient } from "./theme";
import { displayFont, monoFont } from "./fonts";

const CIRCUMFERENCE = 2 * Math.PI * 65; // ~408.41

const formatTime = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation: 2:00:00 -> 1:45:00 over 3 seconds (90 frames)
  const progress = frame / 89; // 0 to 1

  // Timer interpolation: 7200s -> 6300s (15 minutes countdown)
  const timerSeconds = interpolate(frame, [0, 89], [7200, 6300]);
  const timerDisplay = formatTime(timerSeconds);

  // Ring progress: 100% -> 75% filled
  const dashOffset = interpolate(frame, [0, 89], [0, CIRCUMFERENCE * 0.25]);

  // Status pill glow pulse
  const glowIntensity = interpolate(
    Math.sin(frame * 0.15),
    [-1, 1],
    [0.3, 0.8]
  );

  // Entrance spring for the whole card
  const cardScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80, mass: 0.5 },
  });

  // Subtle breathing on the ring
  const ringBreath = interpolate(
    Math.sin(frame * 0.1),
    [-1, 1],
    [0.98, 1.02]
  );

  return (
    <AbsoluteFill
      style={{
        background: colors.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: displayFont,
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(240,192,74,0.12) 0%, transparent 60%)",
          filter: "blur(40px)",
        }}
      />

      {/* App card */}
      <div
        style={{
          width: 360,
          background: `linear-gradient(135deg, ${colors.surface}, ${colors.card})`,
          borderRadius: 20,
          border: `1px solid ${colors.border}`,
          boxShadow:
            "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)",
          padding: "36px 28px 28px",
          textAlign: "center",
          transform: `scale(${cardScale})`,
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              background: gradient,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
          >
            ⚡
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, color: colors.cream }}>
            MacClosedAwake
          </span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: colors.muted,
            marginBottom: 28,
          }}
        >
          Your Mac stays awake. Lid closed or not.
        </div>

        {/* Timer ring */}
        <div
          style={{
            width: 160,
            height: 160,
            margin: "0 auto 24px",
            position: "relative",
            transform: `scale(${ringBreath})`,
          }}
        >
          <svg
            viewBox="0 0 150 150"
            width="160"
            height="160"
            style={{ transform: "rotate(-90deg)" }}
          >
            <defs>
              <linearGradient
                id="ringGrad"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor={colors.gold} />
                <stop offset="100%" stopColor={colors.orange} />
              </linearGradient>
              {/* Glow filter */}
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {/* Background ring */}
            <circle
              cx="75"
              cy="75"
              r="65"
              fill="none"
              stroke={colors.border}
              strokeWidth="5"
            />
            {/* Progress ring */}
            <circle
              cx="75"
              cy="75"
              r="65"
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              filter="url(#glow)"
            />
          </svg>
          {/* Center text */}
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
                fontSize: 34,
                fontWeight: 300,
                color: colors.cream,
                fontFamily: monoFont,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: 1,
              }}
            >
              {timerDisplay}
            </div>
            <div
              style={{
                fontSize: 9,
                color: colors.muted,
                textTransform: "uppercase",
                letterSpacing: 1.5,
                marginTop: 2,
              }}
            >
              remaining
            </div>
          </div>
        </div>

        {/* Status pill */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 14px",
            borderRadius: 16,
            background: `rgba(58,138,138,${0.08 + glowIntensity * 0.06})`,
            border: `1px solid rgba(58,138,138,${0.15 + glowIntensity * 0.15})`,
            boxShadow: `0 0 ${12 + glowIntensity * 8}px rgba(58,138,138,${0.15 + glowIntensity * 0.1})`,
            fontSize: 10,
            fontWeight: 500,
            color: "#5ab8b8",
            fontFamily: monoFont,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#5ab8b8",
              boxShadow: `0 0 ${4 + glowIntensity * 4}px rgba(58,138,138,${0.4 + glowIntensity * 0.3})`,
            }}
          />
          Sleep disabled — {formatTime(timerSeconds)} left
        </div>

        {/* Preset buttons */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
            marginBottom: 10,
          }}
        >
          {["30m", "1h", "2h", "4h", "8h", "12h"].map((label, i) => (
            <div
              key={label}
              style={{
                padding: "10px 0",
                borderRadius: 8,
                background:
                  i === 2
                    ? "linear-gradient(135deg, rgba(240,192,74,0.2), rgba(232,147,90,0.2))"
                    : "rgba(245,238,218,0.04)",
                border:
                  i === 2
                    ? "1px solid rgba(240,192,74,0.35)"
                    : `1px solid ${colors.border}`,
                color: i === 2 ? colors.cream : colors.muted,
                fontSize: 12,
                fontWeight: 500,
                fontFamily: monoFont,
              }}
            >
              {label}
              {i >= 3 && (
                <span style={{ fontSize: 8, opacity: 0.4 }}> PRO</span>
              )}
            </div>
          ))}
        </div>

        {/* Forever mode button */}
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background:
              "linear-gradient(135deg, rgba(232,147,90,0.12), rgba(240,192,74,0.12))",
            border: "1px solid rgba(232,147,90,0.3)",
            color: colors.orange,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: monoFont,
          }}
        >
          ∞ FOREVER MODE
        </div>
      </div>
    </AbsoluteFill>
  );
};
