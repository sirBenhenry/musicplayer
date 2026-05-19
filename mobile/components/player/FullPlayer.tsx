import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
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
import { font, radius } from '../../lib/tokens';
import { togglePlay, seek } from '../../lib/audio';
import * as api from '../../lib/api';

const { width: SW, height: SH } = Dimensions.get('window');
const MINI_H = 60;
const NAV_H = 72;
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
  const { currentSong, isPlaying, progress, activeProfileId } = useStore();
  const [stayInProfile, setStayInProfile] = useState(true);

  const top = useSharedValue(SH - MINI_BOTTOM - MINI_H - MINI_MARGIN);
  const borderR = useSharedValue(radius.card);
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

  const swipeGesture = Gesture.Pan()
    .onEnd((e) => {
      if (e.velocityY > 600 || e.translationY > SH * 0.4) {
        top.value = withSpring(SH - MINI_BOTTOM - MINI_H - MINI_MARGIN, { damping: 24, stiffness: 200 }, () => {
          runOnJS(onClose)();
        });
        borderR.value = withSpring(radius.card);
      }
    });

  if (!currentSong) return null;

  const elapsed = Math.floor(progress * currentSong.duration_sec);
  const remaining = currentSong.duration_sec - elapsed;

  const handleSeek = (e: any) => {
    const w = e.nativeEvent.layout?.width ?? SW - 56;
    const x = e.nativeEvent.locationX;
    seek(Math.max(0, Math.min(1, x / w)));
  };

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
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={12}>
            <Text style={[styles.icon, { color: theme.fgStrong }]}>↓</Text>
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.label, { color: theme.fgMuted }]}>PLAYING FROM</Text>
          </View>
          <View style={styles.iconBtn} />
        </View>

        <View style={styles.body}>
          {/* Cover */}
          <View style={styles.coverWrap}>
            <CoverArt
              uri={currentSong.cover_url}
              size={SW - 56}
              title={currentSong.title}
              borderRadius={16}
              style={{ shadowColor: '#28190f', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.22, shadowRadius: 48 }}
            />
          </View>

          {/* Title + artist */}
          <View style={styles.meta}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={2}>
                {currentSong.title}
              </Text>
              <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
                {currentSong.artist}
              </Text>
            </View>
          </View>

          {/* Progress */}
          <View style={styles.progressWrap}>
            <TouchableOpacity
              activeOpacity={1}
              style={[styles.progressTrack, { backgroundColor: theme.border }]}
              onPress={handleSeek}
            >
              <View
                style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: theme.accent }]}
              />
            </TouchableOpacity>
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
            <TouchableOpacity hitSlop={12}>
              <Text style={[styles.ctrlIcon, { color: theme.fgMuted }]}>⇌</Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={12}>
              <Text style={[styles.ctrlIconLg, { color: theme.fgStrong }]}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={togglePlay}
              style={[styles.playBtn, { backgroundColor: theme.fgStrong }]}
            >
              <Text style={[styles.playIcon, { color: theme.bg }]}>
                {isPlaying ? '⏸' : '▶'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={12}>
              <Text style={[styles.ctrlIconLg, { color: theme.fgStrong }]}>⏭</Text>
            </TouchableOpacity>
            <TouchableOpacity hitSlop={12}>
              <Text style={[styles.ctrlIcon, { color: theme.fgMuted }]}>↺</Text>
            </TouchableOpacity>
          </View>

          {/* Auto-radio scope */}
          <TouchableOpacity
            onPress={() => setStayInProfile(!stayInProfile)}
            style={[styles.radioRow, { backgroundColor: theme.bgElev, borderColor: theme.borderSoft }]}
          >
            <Text style={{ color: theme.fgMuted, fontSize: 12.5 }}>
              Auto-radio:{' '}
              <Text style={{ color: theme.fgStrong, fontWeight: '600' }}>
                {stayInProfile ? 'Profile' : 'Full library'}
              </Text>
            </Text>
            <View
              style={[
                styles.scopeTag,
                { backgroundColor: stayInProfile ? theme.accent : theme.surface, borderColor: stayInProfile ? theme.accent : theme.border },
              ]}
            >
              <Text style={{ color: stayInProfile ? theme.onAccent : theme.fgStrong, fontSize: 11.5, fontWeight: '600' }}>
                {stayInProfile ? 'Stay' : 'Open'}
              </Text>
            </View>
          </TouchableOpacity>
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
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
  label: { fontSize: 10.5, letterSpacing: 0.12, textTransform: 'uppercase', fontWeight: '500' },
  body: { flex: 1, paddingHorizontal: 28, paddingBottom: 24, justifyContent: 'space-between' },
  coverWrap: { alignItems: 'center', paddingVertical: 10 },
  meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  title: { fontSize: 22, fontWeight: '600', letterSpacing: -0.015, lineHeight: 28 },
  artist: { fontSize: 14.5, marginTop: 5 },
  progressWrap: { marginTop: 22 },
  progressTrack: { height: 3, borderRadius: 100, overflow: 'hidden' },
  progressFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 100 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  time: { fontSize: 11.5, letterSpacing: 0.04 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  ctrlIcon: { fontSize: 22 },
  ctrlIconLg: { fontSize: 30 },
  playBtn: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  playIcon: { fontSize: 28 },
  radioRow: {
    marginTop: 22,
    padding: 11,
    paddingHorizontal: 14,
    borderRadius: 100,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scopeTag: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 100,
    borderWidth: 1,
  },
});
