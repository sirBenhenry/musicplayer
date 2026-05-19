import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { CoverArt } from '../shared/CoverArt';
import { Waveform } from '../player/Waveform';
import { togglePlay } from '../../lib/audio';
import { radius } from '../../lib/tokens';

interface Props {
  onPress: () => void;
}

export function MiniPlayer({ onPress }: Props) {
  const theme = useTheme();
  const { currentSong, isPlaying, progress } = useStore();

  if (!currentSong) return null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.95}
      style={[
        styles.container,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          shadowColor: theme.fg,
        },
      ]}
    >
      <CoverArt uri={currentSong.cover_url} size={44} title={currentSong.title} />

      <View style={styles.center}>
        <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={1}>
          {currentSong.title}
        </Text>
        <View style={styles.waveformWrap}>
          <Waveform songId={currentSong.id} progress={progress} height={18} />
        </View>
      </View>

      <TouchableOpacity
        onPress={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        style={styles.playBtn}
        hitSlop={12}
      >
        <Text style={[styles.playIcon, { color: theme.fgStrong }]}>
          {isPlaying ? '⏸' : '▶'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 8,
    right: 8,
    height: 60,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 8,
    paddingRight: 12,
    zIndex: 25,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  center: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  waveformWrap: {
    overflow: 'hidden',
  },
  playBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    fontSize: 18,
  },
});
