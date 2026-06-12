import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../hooks/useTheme';
import { CoverArt } from './CoverArt';
import { Icon } from './Icon';
import { font } from '../../lib/tokens';

const TRIGGER_X = -64;
const MAX_DRAG = -96;

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  song: {
    id: string;
    title: string;
    title_romanized?: string | null;
    artist?: string;
    display_artist?: string | null;
    duration_sec?: number;
    cover_url?: string | null;
  };
  onPress?: () => void;
  onLongPress?: () => void;
  onSwipeQueue?: () => void;
  hideArtist?: boolean;
  index?: number;
  status?: 'kept' | 'delete';
  rightAction?: React.ReactNode;
}

export const SongRow = React.memo(function SongRow({ song, onPress, onLongPress, onSwipeQueue, hideArtist, index, status, rightAction }: Props) {
  const theme = useTheme();

  const translateX = useSharedValue(0);
  const glareTX = useSharedValue(-150);
  const glareAlpha = useSharedValue(0);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, TRIGGER_X], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(
          translateX.value,
          [0, TRIGGER_X, MAX_DRAG],
          [0.5, 1, 1.15],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const glareStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: glareTX.value }],
    opacity: glareAlpha.value,
  }));

  const panGesture = Gesture.Pan()
    .activeOffsetX([-12, 9999])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      translateX.value = Math.max(MAX_DRAG, Math.min(0, e.translationX));
    })
    .onEnd(() => {
      const triggered = translateX.value <= TRIGGER_X;
      if (triggered && onSwipeQueue) {
        runOnJS(onSwipeQueue)();
        translateX.value = withTiming(0, { duration: 130, easing: Easing.out(Easing.cubic) }, (finished) => {
          if (finished) {
            glareTX.value = -150;
            glareAlpha.value = 0;
            glareTX.value = withTiming(450, { duration: 320, easing: Easing.out(Easing.quad) });
            glareAlpha.value = withSequence(
              withTiming(0.22, { duration: 40 }),
              withDelay(190, withTiming(0, { duration: 90 })),
            );
          }
        });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  const inner = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {index !== undefined ? (
        <Text style={[styles.index, { color: theme.fgSoft, fontFamily: font.mono }]}>
          {(index + 1).toString().padStart(2, '0')}
        </Text>
      ) : (
        <CoverArt uri={song.cover_url} size={44} title={song.title} />
      )}

      <View style={styles.info}>
        <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={1}>
          {song.title}
        </Text>
        {song.title_romanized && (
          <Text style={[styles.romanized, { color: theme.fgSoft }]} numberOfLines={1}>
            {song.title_romanized}
          </Text>
        )}
        {!hideArtist && (song.display_artist || song.artist) && (
          <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
            {song.display_artist || song.artist}
          </Text>
        )}
      </View>

      {rightAction}

      {!rightAction && status === 'kept' && (
        <View style={[styles.flagBadge, { backgroundColor: theme.success ?? '#22c55e' }]}>
          <Icon name="check" color="#fff" size={12} strokeWidth={2.5} />
        </View>
      )}

      {!rightAction && status === 'delete' && (
        <View style={[styles.flagBadge, { backgroundColor: theme.danger ?? '#ef4444' }]}>
          <Icon name="close" color="#fff" size={12} strokeWidth={2.5} />
        </View>
      )}

      {!rightAction && status === undefined && song.duration_sec !== undefined && (
        <Text style={[styles.duration, { color: theme.fgSoft, fontFamily: font.mono }]}>
          {fmtTime(song.duration_sec)}
        </Text>
      )}
    </Pressable>
  );

  if (!onSwipeQueue) return inner;

  return (
    <View style={styles.swipeContainer}>
      {/* Icon revealed behind row as you swipe */}
      <Animated.View style={[styles.queueIcon, iconOpacity]}>
        <Icon name="list" color={theme.accent} size={18} />
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.rowClip, rowStyle]}>
          {inner}
          {/* Glare sweep after snap-back */}
          <Animated.View
            pointerEvents="none"
            style={[styles.glare, { backgroundColor: theme.accent }, glareStyle]}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  index: {
    width: 28,
    textAlign: 'center',
    fontSize: 12,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  romanized: {
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 1,
    fontFamily: font.mono,
  },
  artist: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  duration: {
    fontSize: 11.5,
    letterSpacing: 0.04,
  },
  flagBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  swipeContainer: {
    position: 'relative',
  },
  rowClip: {
    overflow: 'hidden',
  },
  queueIcon: {
    position: 'absolute',
    right: 20,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
  },
  glare: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 150,
  },
});
