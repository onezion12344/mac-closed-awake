import { Composition } from "remotion";
import { Demo } from "./Demo";
import { Video } from "./Video";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={90}
        fps={30}
        width={400}
        height={500}
      />
      <Composition
        id="ProductVideo"
        component={Video}
        durationInFrames={1290}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
