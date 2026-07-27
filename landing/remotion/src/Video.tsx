import React from "react";
import { AbsoluteFill, Audio, Series, staticFile } from "remotion";
import { colors } from "./theme";
import { Intro } from "./scenes/Intro";
import { Problem } from "./scenes/Problem";
import { Solution } from "./scenes/Solution";
import { Timer } from "./scenes/Timer";
import { CTA } from "./scenes/CTA";

// 1290 frames @30fps = 43.0s (narration.wav is 42.72s)
export const Video: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: colors.bg }}>
      <Series>
        <Series.Sequence durationInFrames={120}>
          <Intro />
        </Series.Sequence>
        <Series.Sequence durationInFrames={240}>
          <Problem />
        </Series.Sequence>
        <Series.Sequence durationInFrames={360}>
          <Solution />
        </Series.Sequence>
        <Series.Sequence durationInFrames={270}>
          <Timer />
        </Series.Sequence>
        <Series.Sequence durationInFrames={300}>
          <CTA />
        </Series.Sequence>
      </Series>
      <Audio src={staticFile("narration.wav")} />
    </AbsoluteFill>
  );
};
