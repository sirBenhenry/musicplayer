import React, { useEffect, useState } from 'react';
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
import { Waveform } from './Waveform';
import { SongActionSheet } from '../shared/SongActionSheet';
import { PlaylistPickerModal } from '../shared/PlaylistPickerModal';
import { ProfilePickerModal } from '../shared/ProfilePickerModal';
import { font, radius } from '../../lib/tokens';
import { flagSong } from '../../lib/api';
import * as haptics from '../../lib/haptics';
import {
  togglePlay, seek, skipToNext, skipToPrev, cycleRepeatMode, shuffleUpcoming,
} from '../../lib/audio';

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
  const {
    currentSong, isPlaying, progress, activeProfileId, profiles,
    queue, queueIndex, explicitQueue, autoQueue, setQueueOpen,
    playlistId, radioScope, setRadioScope, repeatMode,
  } = useStore();
  const [kept, setKept] = useState(false);
  const [shuffledOnce, setShuffledOnce] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekProgress, setSeekProgress] = useState(0);
  const [actionOpen, setActionOpen] = useState(false);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const seekTrackWidth = SW - 56;

  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const isDaily = !!playlistId;
  // Priority: explicit queue → auto queue → next in playlist context
  const nextSong = explicitQueue[0] ?? autoQueue[0] ?? (queueIndex + 1 < queue.length ? queue[queueIndex + 1] : null);

  // Reset per-song flags when the track changes
  useEffect(() => {
    setKept(false);
    setShuffledOnce(false);
  }, [currentSong?.id]);

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
      runOnJS(haptics.selection)();
      runOnJS(seek)(pct);
      runOnJS(setIsSeeking)(false);
    })
    .onFinalize(() => {
      runOnJS(setIsSeeking)(false);
    });

  const handleKeep = () => {
    if (!isDaily || !playlistId || kept) return;
    setKept(true);
    haptics.success();
    flagSong(playlistId, currentSong.id, 'keep').catch(() => setKept(false));
  };

  const handleShuffle = async () => {
    haptics.selection();
    setShuffledOnce(true);
    await shuffleUpcoming();
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
          <Pressable onPress={onClose} style={styles.iconBtn} hitSlop={12}>
            <Icon name="chevronDown" color={theme.fgStrong} size={24} />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.label, { color: theme.fgMuted, fontFamily: font.mono }]}>
              {isDaily ? 'DAILY PLAYLIST' : 'PLAYING FROM'}
            </Text>
            {profile && (
              <Text style={[styles.profileName, { color: theme.fgStrong }]}>
                {profile.name}
              </Text>
            )}
          </View>
          <Pressable onPress={() => setActionOpen(true)} style={styles.iconBtn} hitSlop={12}>
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

          {/* Title + keep-heart (daily only) */}
          <View style={styles.meta}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={2}>
                {currentSong.title}
              </Text>
              <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
                {currentSong.artist}
              </Text>
            </View>
            {isDaily && (
              <Pressable onPress={handleKeep} style={styles.iconBtn} hitSlop={12}>
                <Icon
                  name={kept ? 'heartFill' : 'heart'}
                  color={kept ? theme.accent : theme.fgMuted}
                  size={24}
                />
              </Pressable>
            )}
          </View>

          {/* Waveform progress + seek */}
          <View style={styles.progressWrap}>
            <GestureDetector gesture={seekGesture}>
              <View style={styles.seekHitArea}>
                <Waveform
                  songId={currentSong.id}
                  progress={displayProgress}
                  height={36}
                  width={seekTrackWidth}
                />
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
            <Pressable hitSlop={12} onPress={handleShuffle}>
              <Icon
                name="shuffle"
                color={shuffledOnce ? theme.accent : theme.fgMuted}
                size={22}
              />
            </Pressable>
            <Pressable hitSlop={12} onPress={skipToPrev}>
              <Icon name="prev" color={theme.fgStrong} size={30} />
            </Pressable>
            <Pressable
              onPress={togglePlay}
              style={({ pressed }) => [
                styles.playBtn,
                { backgroundColor: theme.fgStrong, transform: [{ scale: pressed ? 0.96 : 1 }] },
              ]}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} color={theme.bg} size={28} />
            </Pressable>
            <Pressable hitSlop={12} onPress={skipToNext}>
              <Icon name="skip" color={theme.fgStrong} size={30} />
            </Pressable>
            <Pressable hitSlop={12} onPress={() => { haptics.selection(); cycleRepeatMode(); }} style={{ position: 'relative' }}>
              <Icon
                name="repeat"
                color={repeatMode === 'off' ? theme.fgMuted : theme.accent}
                size={22}
              />
              {repeatMode === 'track' && (
                <View style={[styles.repeatOneDot, { backgroundColor: theme.accent }]}>
                  <Text style={{ color: theme.onAccent, fontSize: 8, fontWeight: '700', lineHeight: 10 }}>1</Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Auto-radio scope */}
          <View style={[styles.radioRow, { backgroundColor: theme.bgElev, borderColor: theme.borderSoft }]}>
            <Icon name="radio" color={theme.fgMuted} size={18} strokeWidth={1.6} />
            <Text style={[styles.radioLabel, { color: theme.fgMuted }]}>
              {'Auto-radio: '}
              <Text style={{ color: theme.fgStrong, fontWeight: '600' }}>
                {radioScope === 'profile' && profile ? profile.name : 'Full library'}
              </Text>
            </Text>
            <Pressable
              onPress={() => { haptics.selection(); setRadioScope(radioScope === 'profile' ? 'library' : 'profile'); }}
              style={[
                styles.radioTag,
                {
                  backgroundColor: radioScope === 'profile' ? theme.accent : theme.surface,
                  borderColor: radioScope === 'profile' ? theme.accent : theme.border,
                },
              ]}
            >
              <Text style={{ color: radioScope === 'profile' ? theme.onAccent : theme.fgStrong, fontSize: 11.5, fontWeight: '600' }}>
                {radioScope === 'profile' ? 'Stay' : 'Open'}
              </Text>
            </Pressable>
          </View>

          {/* Up next */}
          {nextSong ? (
            <Pressable onPress={() => setQueueOpen(true)} style={({ pressed }) => [styles.upNext, { opacity: pressed ? 0.7 : 1 }]}>
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
              <Icon name="list" color={theme.fgSoft} size={18} strokeWidth={1.6} />
            </Pressable>
          ) : (
            <View style={styles.upNext}>
              <Pressable onPress={() => setQueueOpen(true)} hitSlop={8} style={{ marginLeft: 'auto' }}>
                <Icon name="list" color={theme.fgSoft} size={18} strokeWidth={1.6} />
              </Pressable>
            </View>
          )}
        </View>

        {/* Song actions for the current track */}
        <SongActionSheet
          visible={actionOpen}
          song={currentSong ? { id: currentSong.id, title: currentSong.title } : null}
          onClose={() => setActionOpen(false)}
          onAddToPlaylist={() => setPlaylistPickerOpen(true)}
          onAssignProfile={() => setProfilePickerOpen(true)}
          onDeleted={() => {
            setActionOpen(false);
            skipToNext().catch(() => {});
          }}
        />
        <PlaylistPickerModal
          visible={playlistPickerOpen}
          songId={currentSong?.id ?? ''}
          songTitle={currentSong?.title ?? ''}
          onClose={() => setPlaylistPickerOpen(false)}
          onAdded={() => setPlaylistPickerOpen(false)}
        />
        <ProfilePickerModal
          visible={profilePickerOpen}
          songId={currentSong?.id ?? ''}
          songTitle={currentSong?.title ?? ''}
          onClose={() => setProfilePickerOpen(false)}
          onAssigned={() => setProfilePickerOpen(false)}
        />
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
    marginTop: 18,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
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
  repeatOneDot: {
    position: 'absolute',
    top: -4,
    right: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 54,
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
    height: 40,
    justifyContent: 'center',
  },
});
