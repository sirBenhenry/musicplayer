import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { useTheme } from '../../hooks/useTheme';

const BAR_WIDTH = 1.5;
const BAR_GAP = 1.5;
const DEFAULT_BAR_COUNT = 54;

function seededHeights(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return Array.from({ length: count }, (_, i) => {
    h = (Math.imul(1664525, h) + 1013904223) | 0;
    const n = (h >>> 0) / 0xffffffff;
    return 0.15 + 0.85 * Math.pow(Math.sin((i / count) * Math.PI) * 0.6 + 0.4 + n * 0.4, 1.2);
  });
}

interface Props {
  songId: string;
  progress: number;
  height?: number;
  /** Optional target width — bar count derives from it (mini player uses the 54-bar default). */
  width?: number;
}

export function Waveform({ songId, progress, height = 32, width }: Props) {
  const theme = useTheme();
  const barCount = width
    ? Math.max(16, Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP)))
    : DEFAULT_BAR_COUNT;
  const heights = useMemo(() => seededHeights(songId, barCount), [songId, barCount]);
  const totalWidth = barCount * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
  const playedBars = Math.floor(progress * barCount);

  return (
    <View style={{ height, justifyContent: 'center' }}>
      <Svg width={totalWidth} height={height}>
        {heights.map((h, i) => {
          const barH = Math.max(2, h * height);
          const x = i * (BAR_WIDTH + BAR_GAP);
          const y = (height - barH) / 2;
          const played = i <= playedBars;
          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={barH}
              rx={BAR_WIDTH / 2}
              fill={played ? theme.accent : theme.fgSoft}
              opacity={played ? 1 : 0.32}
            />
          );
        })}
      </Svg>
    </View>
  );
}
