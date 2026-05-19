import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { CoverArt } from './CoverArt';
import { font } from '../../lib/tokens';

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  song: {
    id: string;
    title: string;
    artist?: string;
    duration_sec?: number;
    cover_url?: string | null;
  };
  onPress?: () => void;
  hideArtist?: boolean;
  index?: number;
  status?: 'kept' | 'delete';
  rightAction?: React.ReactNode;
}

export function SongRow({ song, onPress, hideArtist, index, status, rightAction }: Props) {
  const theme = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.row, { borderBottomColor: theme.borderSoft }]}
    >
      {index !== undefined ? (
        <Text style={[styles.index, { color: theme.fgSoft, fontFamily: font.mono }]}>
          {(index + 1).toString().padStart(2, '0')}
        </Text>
      ) : (
        <CoverArt uri={song.cover_url} size={44} title={song.title} />
      )}

      <View style={styles.info}>
        <Text
          style={[styles.title, { color: theme.fgStrong }]}
          numberOfLines={1}
        >
          {song.title}
        </Text>
        {!hideArtist && song.artist && (
          <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
            {song.artist}
          </Text>
        )}
      </View>

      {rightAction}

      {!rightAction && status === undefined && song.duration_sec !== undefined && (
        <Text style={[styles.duration, { color: theme.fgSoft, fontFamily: font.mono }]}>
          {fmtTime(song.duration_sec)}
        </Text>
      )}
    </TouchableOpacity>
  );
}

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
  artist: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  duration: {
    fontSize: 11.5,
    letterSpacing: 0.04,
  },
});
