import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

interface IcProps {
  color: string;
  size: number;
  sw: number; // strokeWidth
  children: React.ReactNode;
}

function Ic({ color, size, sw, children }: IcProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export interface IconProps {
  color: string;
  size?: number;
  strokeWidth?: number;
}

const icons = {
  home: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" stroke={color}/>
    </Ic>
  ),
  library: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M5 4h14M5 9h14M5 14h9" stroke={color}/>
      <Circle cx="17" cy="17" r="3" stroke={color}/>
      <Path d="m20 20 1.5 1.5" stroke={color}/>
    </Ic>
  ),
  search: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Circle cx="11" cy="11" r="6.5" stroke={color}/>
      <Path d="m16 16 4 4" stroke={color}/>
    </Ic>
  ),
  play: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M7 5v14l12-7z" fill={color} stroke="none"/>
    </Ic>
  ),
  pause: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Rect x="6" y="5" width="4" height="14" rx="0.8" fill={color} stroke="none"/>
      <Rect x="14" y="5" width="4" height="14" rx="0.8" fill={color} stroke="none"/>
    </Ic>
  ),
  skip: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M6 5v14l9-7z" fill={color} stroke="none"/>
      <Path d="M17 5v14" stroke={color}/>
    </Ic>
  ),
  prev: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M18 5v14l-9-7z" fill={color} stroke="none"/>
      <Path d="M7 5v14" stroke={color}/>
    </Ic>
  ),
  shuffle: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M3 6h3l12 12h3M3 18h3l4-4M14 10l4-4h3M18 3l3 3-3 3M18 15l3 3-3 3" stroke={color}/>
    </Ic>
  ),
  repeat: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M17 3l3 3-3 3M4 13v-4a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 11v4a3 3 0 0 1-3 3H4" stroke={color}/>
    </Ic>
  ),
  heart: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" stroke={color}/>
    </Ic>
  ),
  heartFill: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" fill={color} stroke={color}/>
    </Ic>
  ),
  dots: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Circle cx="5" cy="12" r="1.3" fill={color} stroke="none"/>
      <Circle cx="12" cy="12" r="1.3" fill={color} stroke="none"/>
      <Circle cx="19" cy="12" r="1.3" fill={color} stroke="none"/>
    </Ic>
  ),
  plus: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M12 5v14M5 12h14" stroke={color}/>
    </Ic>
  ),
  check: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="m5 12 5 5 9-11" stroke={color}/>
    </Ic>
  ),
  chevronDown: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="m6 9 6 6 6-6" stroke={color}/>
    </Ic>
  ),
  chevronRight: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="m9 6 6 6-6 6" stroke={color}/>
    </Ic>
  ),
  close: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M6 6l12 12M18 6 6 18" stroke={color}/>
    </Ic>
  ),
  clock: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Circle cx="12" cy="12" r="8" stroke={color}/>
      <Path d="M12 7v5l3 2" stroke={color}/>
    </Ic>
  ),
  trash: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" stroke={color}/>
    </Ic>
  ),
  settings: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Circle cx="12" cy="12" r="3" stroke={color}/>
      <Path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke={color}/>
    </Ic>
  ),
  download: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14" stroke={color}/>
    </Ic>
  ),
  refresh: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" stroke={color}/>
    </Ic>
  ),
  list: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M4 6h16M4 12h16M4 18h10" stroke={color}/>
    </Ic>
  ),
  filter: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M4 5h16l-6 8v6l-4-2v-4z" stroke={color}/>
    </Ic>
  ),
  radio: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Circle cx="12" cy="12" r="2" stroke={color}/>
      <Path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" stroke={color}/>
    </Ic>
  ),
  history: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M3 12a9 9 0 1 0 3-6.7" stroke={color}/>
      <Path d="M3 4v5h5" stroke={color}/>
      <Path d="M12 8v4l3 2" stroke={color}/>
    </Ic>
  ),
  artist: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Circle cx="12" cy="8" r="3.5" stroke={color}/>
      <Path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" stroke={color}/>
    </Ic>
  ),
  sparkle: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M12 4v4M12 16v4M4 12h4M16 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" stroke={color}/>
    </Ic>
  ),
  arrowLeft: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M19 12H5M11 6l-6 6 6 6" stroke={color}/>
    </Ic>
  ),
  notification: ({ color, size = 22, strokeWidth = 1.6 }: IconProps) => (
    <Ic color={color} size={size} sw={strokeWidth}>
      <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke={color}/>
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" stroke={color}/>
    </Ic>
  ),
};

export type IconName = keyof typeof icons;

export function Icon({ name, color, size = 22, strokeWidth = 1.6 }: { name: IconName; color: string; size?: number; strokeWidth?: number }) {
  const Comp = icons[name];
  if (!Comp) return null;
  return <Comp color={color} size={size} strokeWidth={strokeWidth} />;
}
