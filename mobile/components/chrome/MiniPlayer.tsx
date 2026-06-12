import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { CoverArt } from '../shared/CoverArt';
import { Icon } from '../shared/Icon';
import { Waveform } from '../player/Waveform';
import { togglePlay } from '../../lib/audio';
import * as haptics from '../../lib/haptics';
import { radius } from '../../lib/tokens';

interface Props {
  onPress: () => void;
}

export function MiniPlayer({ onPress }: Props) {
  const theme = useTheme();
  const { currentSong, isPlaying, progress, profileMenuOpen } = useStore();

  if (!currentSong || profileMenuOpen) return null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.fg,
          opacity: pressed ? 0.94 : 1,
        },
      ]}
    >
      <CoverArt uri={currentSong.cover_url} size={52} title={currentSong.title} />

      <View style={styles.center}>
        <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={1}>
          {currentSong.title}
        </Text>
        <View style={styles.subRow}>
          <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
            {currentSong.artist}
          </Text>
          <View style={styles.waveWrap}>
            <Waveform songId={currentSong.id} progress={progress} height={18} />
          </View>
        </View>
      </View>

      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          haptics.tap();
          togglePlay();
        }}
        style={[styles.playBtn, { backgroundColor: theme.accent }]}
        hitSlop={8}
      >
        <Icon name={isPlaying ? 'pause' : 'play'} color={theme.onAccent} size={18} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 8,
    right: 8,
    height: 72,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingLeft: 10,
    paddingRight: 12,
    zIndex: 10,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  center: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 5,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.005,
    lineHeight: 18,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  artist: {
    fontSize: 11,
    flexShrink: 0,
    maxWidth: '40%',
  },
  waveWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
