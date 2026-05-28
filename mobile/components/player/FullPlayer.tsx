import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  StatusBar,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { CoverArt } from '../shared/CoverArt';
import { Icon } from '../shared/Icon';
import { font, radius } from '../../lib/tokens';
import { togglePlay, seek, skipToNext, skipToPrev } from '../../lib/audio';

const { width: SW, height: SH } = Dimensions.get('window');
const NAV_H = 72;
const MINI_H = 72;
const MINI_BOTTOM = NAV_H;
const MINI_MARGIN = 8;

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  onClose: () => void;
}

export function FullPlayer({ onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { currentSong, isPlaying, progress, activeProfileId, profiles, queue, queueIndex, setQueueOpen } = useStore();
  const [stayInProfile, setStayInProfile] = useState(true);
  const [liked, setLiked] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekProgress, setSeekProgress] = useState(0);
  const seekTrackWidth = SW - 56;

  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const nextSong = queueIndex + 1 < queue.length ? queue[queueIndex + 1] : null;

  const top = useSharedValue(SH - MINI_BOTTOM - MINI_H - MINI_MARGIN);
  const borderR = useSharedValue<number>(radius.card);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    top.value = withSpring(0, { damping: 26, stiffness: 220 });
    borderR.value = withSpring(0, { damping: 26, stiffness: 220 });
    opacity.value = withTiming(1, { duration: 80 });
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    top: top.value,
    bottom: 0,
    left: top.value > 0 ? MINI_MARGIN : 0,
    right: top.value > 0 ? MINI_MARGIN : 0,
    borderRadius: borderR.value,
    opacity: opacity.value,
  }));

  const swipeGesture = Gesture.Pan().onEnd((e) => {
    if (e.velocityY > 600 || e.translationY > SH * 0.4) {
      top.value = withSpring(
        SH - MINI_BOTTOM - MINI_H - MINI_MARGIN,
        { damping: 24, stiffness: 200 },
        () => { runOnJS(onClose)(); },
      );
      borderR.value = withSpring(radius.card);
    }
  });

  if (!currentSong) return null;

  const displayProgress = isSeeking ? seekProgress : progress;
  const elapsed = Math.floor(displayProgress * (currentSong?.duration_sec ?? 0));
  const remaining = (currentSong?.duration_sec ?? 0) - elapsed;

  const seekGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      runOnJS(setIsSeeking)(true);
      const pct = Math.max(0, Math.min(1, e.x / seekTrackWidth));
      runOnJS(setSeekProgress)(pct);
    })
    .onUpdate((e) => {
      const pct = Math.max(0, Math.min(1, e.x / seekTrackWidth));
      runOnJS(setSeekProgress)(pct);
    })
    .onEnd((e) => {
      const pct = Math.max(0, Math.min(1, e.x / seekTrackWidth));
      runOnJS(seek)(pct);
      runOnJS(setIsSeeking)(false);
    })
    .onFinalize(() => {
      runOnJS(setIsSeeking)(false);
    });

  return (
    <GestureDetector gesture={swipeGesture}>
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: theme.bg, zIndex: 60, overflow: 'hidden' },
          animStyle,
        ]}
      >
        <StatusBar barStyle={theme.fg === '#1f1a14' ? 'dark-content' : 'light-content'} />

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
          <Pressable onPress={onClose} style={styles.iconBtn} hitSlop={12}>
            <Icon name="chevronDown" color={theme.fgStrong} size={24} />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.label, { color: theme.fgMuted, fontFamily: font.mono }]}>
              PLAYING FROM
            </Text>
            {profile && (
              <Text style={[styles.profileName, { color: theme.fgStrong }]}>
                {profile.name}
              </Text>
            )}
          </View>
          <Pressable style={styles.iconBtn} hitSlop={12}>
            <Icon name="dots" color={theme.fgStrong} size={22} />
          </Pressable>
        </View>

        <View style={styles.body}>
          {/* Cover art */}
          <View style={styles.coverWrap}>
            <CoverArt
              uri={currentSong.cover_url}
              size={SW - 56}
              title={currentSong.title}
              borderRadius={16}
              style={{
                shadowColor: '#28190f',
                shadowOffset: { width: 0, height: 16 },
                shadowOpacity: 0.22,
                shadowRadius: 48,
                elevation: 16,
              }}
            />
          </View>

          {/* Title + heart */}
          <View style={styles.meta}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={2}>
                {currentSong.title}
              </Text>
              <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
                {currentSong.artist}
              </Text>
            </View>
            <Pressable
              onPress={() => setLiked(!liked)}
              style={styles.iconBtn}
              hitSlop={12}
            >
              <Icon
                name={liked ? 'heartFill' : 'heart'}
                color={liked ? theme.accent : theme.fgMuted}
                size={24}
              />
            </Pressable>
          </View>

          {/* Progress */}
          <View style={styles.progressWrap}>
            <GestureDetector gesture={seekGesture}>
              <View style={styles.seekHitArea}>
                <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
                  <View
                    style={[styles.progressFill, { width: `${displayProgress * 100}%` as any, backgroundColor: theme.accent }]}
                  />
                  <View
                    style={[
                      styles.progressThumb,
                      { left: `${displayProgress * 100}%` as any, backgroundColor: theme.accent,
                        transform: [{ scale: isSeeking ? 1.4 : 1 }] },
                    ]}
                  />
                </View>
              </View>
            </GestureDetector>
            <View style={styles.timeRow}>
              <Text style={[styles.time, { color: theme.fgSoft, fontFamily: font.mono }]}>
                {fmtTime(elapsed)}
              </Text>
              <Text style={[styles.time, { color: theme.fgSoft, fontFamily: font.mono }]}>
                −{fmtTime(remaining)}
              </Text>
            </View>
          </View>

          {/* Controls */}
          <View style={styles.controls}>
            <Pressable hitSlop={12}>
              <Icon name="shuffle" color={theme.fgMuted} size={22} />
            </Pressable>
            <Pressable hitSlop={12} onPress={skipToPrev}>
              <Icon name="prev" color={theme.fgStrong} size={30} />
            </Pressable>
            <Pressable
              onPress={togglePlay}
              style={[styles.playBtn, { backgroundColor: theme.fgStrong }]}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} color={theme.bg} size={28} />
            </Pressable>
            <Pressable hitSlop={12} onPress={skipToNext}>
              <Icon name="skip" color={theme.fgStrong} size={30} />
            </Pressable>
            <Pressable hitSlop={12}>
              <Icon name="repeat" color={theme.fgMuted} size={22} />
            </Pressable>
          </View>

          {/* Auto-radio scope */}
          <View style={[styles.radioRow, { backgroundColor: theme.bgElev, borderColor: theme.borderSoft }]}>
            <Icon name="radio" color={theme.fgMuted} size={18} strokeWidth={1.6} />
            <Text style={[styles.radioLabel, { color: theme.fgMuted }]}>
              {'Auto-radio: '}
              <Text style={{ color: theme.fgStrong, fontWeight: '600' }}>
                {stayInProfile && profile ? profile.name : 'Full library'}
              </Text>
            </Text>
            <Pressable
              onPress={() => setStayInProfile(!stayInProfile)}
              style={[
                styles.radioTag,
                {
                  backgroundColor: stayInProfile ? theme.accent : theme.surface,
                  borderColor: stayInProfile ? theme.accent : theme.border,
                },
              ]}
            >
              <Text style={{ color: stayInProfile ? theme.onAccent : theme.fgStrong, fontSize: 11.5, fontWeight: '600' }}>
                {stayInProfile ? 'Stay' : 'Open'}
              </Text>
            </Pressable>
          </View>

          {/* Up next */}
          {nextSong && (
            <View style={styles.upNext}>
              <CoverArt uri={nextSong.cover_url} size={34} title={nextSong.title} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.upNextLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
                  UP NEXT
                </Text>
                <Text style={[styles.upNextTitle, { color: theme.fgStrong }]} numberOfLines={1}>
                  {nextSong.title}
                  {'  '}
                  <Text style={{ color: theme.fgMuted }}>{nextSong.artist}</Text>
                </Text>
              </View>
              <Pressable onPress={() => setQueueOpen(true)} hitSlop={8}>
                <Icon name="list" color={theme.fgSoft} size={18} strokeWidth={1.6} />
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10.5,
    letterSpacing: 0.12,
    textTransform: 'uppercase',
    fontWeight: '500',
    marginBottom: 2,
  },
  profileName: {
    fontSize: 13,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    paddingHorizontal: 28,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  coverWrap: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.015,
    lineHeight: 28,
  },
  artist: {
    fontSize: 14.5,
    marginTop: 5,
  },
  progressWrap: {
    marginTop: 22,
  },
  progressTrack: {
    height: 3,
    borderRadius: 100,
    overflow: 'visible',
    position: 'relative',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 100,
  },
  progressThumb: {
    position: 'absolute',
    top: '50%',
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: -6,
    marginLeft: -6,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  time: {
    fontSize: 11.5,
    letterSpacing: 0.04,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  playBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
    shadowColor: '#28190f',
  },
  radioRow: {
    marginTop: 22,
    padding: 11,
    paddingHorizontal: 14,
    borderRadius: 100,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  radioLabel: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
  },
  radioTag: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 100,
    borderWidth: 1,
  },
  upNext: {
    marginTop: 14,
    padding: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  upNextLabel: {
    fontSize: 9.5,
    letterSpacing: 0.1,
    marginBottom: 2,
  },
  upNextTitle: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  seekHitArea: {
    height: 36,
    justifyContent: 'center',
    marginHorizontal: -4,
    paddingHorizontal: 4,
  },
});
