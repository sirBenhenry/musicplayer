import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { useTheme } from '../../hooks/useTheme';
import { Profile } from '../../lib/store';

const { width: SW, height: SH } = Dimensions.get('window');
const NODE_R = 36;
const NAV_H = 72;

export const HOVER_THRESHOLD = 52;

// ── Layout ────────────────────────────────────────────────────────────────────
// Two-ring organic layout. Inner ring closer + narrower arc, outer ring wider.
// Hard floor: nodes never go below (SH - NAV_H - NODE_R - 12).

const FLOOR_Y = SH - NAV_H - NODE_R - 12;

function clamp(x: number, y: number) {
  return { x, y: Math.min(y, FLOOR_Y) };
}

export function computeNodePositions(
  count: number,
  cx: number,
  cy: number,
): Array<{ x: number; y: number }> {
  if (count === 0) return [];

  // Seeded jitter — organic feel without perfect symmetry
  const jx = (i: number) => Math.sin(i * 2.6 + 1.1) * 11;
  const jy = (i: number) => Math.cos(i * 1.8 + 0.5) * 8;

  // Grid layout: nodes fill rows bottom-up (closest row to anchor first).
  // Max 3 per row. COL_GAP and ROW_GAP sized so NODE_R=36 nodes never overlap.
  const MAX_COLS = 3;
  const COL_GAP  = 104;  // center-to-center horizontal (diameter 72 + 32 gap)
  const ROW_GAP  = 100;  // center-to-center vertical   (diameter 72 + 28 gap)
  const BASE_Y   = cy - 108; // bottom row center Y (just above anchor)

  const positions: Array<{ x: number; y: number }> = [];
  let idx = 0;
  let row = 0;

  while (idx < count) {
    const remaining  = count - idx;
    const colsInRow  = Math.min(MAX_COLS, remaining);
    const rowY       = BASE_Y - row * ROW_GAP;
    // Centre each row around cx
    const rowStartX  = cx - ((colsInRow - 1) * COL_GAP) / 2;

    for (let col = 0; col < colsInRow; col++) {
      positions.push(clamp(
        rowStartX + col * COL_GAP + jx(idx),
        rowY + jy(idx),
      ));
      idx++;
    }
    row++;
  }

  return positions;
}

// ── Hub ring ──────────────────────────────────────────────────────────────────

function HubRing({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
    scale.value = withSpring(1, { damping: 10, stiffness: 140, mass: 1.1 });
  }, []);

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left: cx - 34,
    top: cy - 34,
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.5,
    borderColor: color,
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View pointerEvents="none" style={style} />;
}

// ── Profile node ──────────────────────────────────────────────────────────────

interface NodeProps {
  profile: Profile;
  cx: number; cy: number;
  tx: number; ty: number;
  isHovered: boolean;
  isActive: boolean;
  index: number;
  theme: any;
}

function ProfileNode({ profile, cx, cy, tx, ty, isHovered, isActive, index, theme }: NodeProps) {
  const spring = useSharedValue(0);
  const hScale = useSharedValue(1);

  useEffect(() => {
    // Each node gets slightly different spring physics → organic asynchronous settling
    const damping  = 7.5 + (index % 4) * 1.2;   // 7.5 → 11.1 — underdamped = bouncy
    const stiffness = 148 + Math.sin(index * 1.9) * 22; // 126 → 170
    const mass = 0.92 + Math.cos(index * 2.3) * 0.12;   // 0.80 → 1.04
    spring.value = withDelay(
      index * 35,
      withSpring(1, { damping, stiffness, mass }),
    );
  }, []);

  useEffect(() => {
    hScale.value = withSpring(isHovered ? 1.22 : 1, { damping: 11, stiffness: 260 });
  }, [isHovered]);

  const posStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: cx + (tx - cx) * spring.value - NODE_R,
    top:  cy + (ty - cy) * spring.value - NODE_R,
    width: NODE_R * 2,
    height: NODE_R * 2,
    borderRadius: NODE_R,
    opacity: spring.value,
    transform: [{ scale: hScale.value }],
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        posStyle,
        {
          backgroundColor: isHovered ? theme.accent : theme.surface,
          borderWidth: isActive && !isHovered ? 2 : 1,
          borderColor: isHovered ? theme.accent : isActive ? theme.accent : theme.borderSoft,
          shadowColor: isHovered ? theme.accent : '#000',
          shadowOffset: { width: 0, height: isHovered ? 7 : 3 },
          shadowOpacity: isHovered ? 0.48 : 0.1,
          shadowRadius: isHovered ? 22 : 8,
          elevation: isHovered ? 16 : 4,
        },
      ]}
    >
      <Text style={{ fontSize: 22, lineHeight: 26 }}>{profile.glyph ?? '♪'}</Text>
      <Text
        style={[styles.label, { color: isHovered ? theme.onAccent : theme.fgStrong }]}
        numberOfLines={1}
      >
        {profile.name}
      </Text>
      {isActive && !isHovered && (
        <Animated.View style={[styles.activeDot, { backgroundColor: theme.accent }]} />
      )}
    </Animated.View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export interface RadialSwitcherProps {
  anchorX: number;
  anchorY: number;
  profiles: Profile[];
  activeProfileId: string | null;
  hoveredId: string | null;
}

export function RadialSwitcher({
  anchorX, anchorY, profiles, activeProfileId, hoveredId,
}: RadialSwitcherProps) {
  const theme = useTheme();
  const positions = computeNodePositions(profiles.length, anchorX, anchorY);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    backdropOpacity.value = withTiming(1, { duration: 220 });
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value * 0.5,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, { zIndex: 20 }]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }, backdropStyle]} />

      <Svg width={SW} height={SH} style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {positions.map((pos, i) => (
          <Line
            key={i}
            x1={anchorX} y1={anchorY}
            x2={pos.x} y2={pos.y}
            stroke={theme.accent}
            strokeWidth={1}
            strokeOpacity={0.18}
          />
        ))}
      </Svg>

      <HubRing cx={anchorX} cy={anchorY} color={theme.accent} />

      {profiles.map((profile, i) => (
        <ProfileNode
          key={profile.id}
          profile={profile}
          cx={anchorX}
          cy={anchorY}
          tx={positions[i].x}
          ty={positions[i].y}
          isHovered={hoveredId === profile.id}
          isActive={activeProfileId === profile.id}
          index={i}
          theme={theme}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
    letterSpacing: 0.01,
    paddingHorizontal: 4,
  },
  activeDot: {
    position: 'absolute',
    bottom: 6,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
