import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStore } from '../../lib/store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { Icon } from '../../components/shared/Icon';
import { SongRow } from '../../components/shared/SongRow';
import { getPlaylist, pausePlaylist, getStreamUrl } from '../../lib/api';
import { playSong, addToQueue } from '../../lib/audio';
import { font, radius } from '../../lib/tokens';

const SLOT_LABELS: Record<string, string> = {
  close: 'Close Match',
  broader: 'Broader Taste',
  genre: 'New Genre',
  artist: 'Artist of the Day',
};

export default function PlaylistScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<any>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!id) return;
    getPlaylist(id).then((pl) => {
      setPlaylist(pl);
      setPaused(pl.paused_to_tomorrow);
    }).catch(() => {});
  }, [id]);

  const handlePause = async () => {
    if (!id) return;
    await pausePlaylist(id);
    setPaused(true);
  };

  const songs: any[] = (playlist?.songs ?? []).filter((s: any) => !s._genre && !s._artist_of_day && s.navidrome_id);
  const slotLabel = SLOT_LABELS[playlist?.slot] ?? 'Playlist';

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text style={[styles.slot, { color: theme.fgMuted, fontFamily: font.mono }]}>
            {slotLabel.toUpperCase()}
          </Text>
          <Text style={[styles.title, { color: theme.fgStrong }]}>
            {playlist?.slot === 'genre'
              ? (playlist.songs?.[0]?._genre ?? 'New genre')
              : playlist?.slot === 'artist'
              ? (playlist.songs?.[0]?._artist_of_day ?? 'Artist of the day')
              : slotLabel}
          </Text>
        </View>
        {!paused && playlist?.slot && (
          <TouchableOpacity
            onPress={handlePause}
            style={[styles.pauseBtn, { borderColor: theme.border }]}
          >
            <Text style={[styles.pauseText, { color: theme.fgMuted }]}>Tomorrow</Text>
          </TouchableOpacity>
        )}
        {paused && (
          <View style={[styles.pauseBtn, { borderColor: theme.accentTint }]}>
            <Text style={[styles.pauseText, { color: theme.accent }]}>Paused</Text>
          </View>
        )}
      </View>

      <FlatList
        data={songs}
        keyExtractor={(s, i) => s.id ?? String(i)}
        renderItem={({ item, index }) => (
          <SongRow
            song={{ ...item, artist: item.artist ?? '' }}
            index={index}
            onSwipeQueue={() => addToQueue({ ...item, artist: item.artist ?? '', duration_sec: item.duration_sec ?? 0 })}
            onPress={() => {
              const url = getStreamUrl(item.navidrome_id);
              useStore.getState().setQueue(
                songs.map((s) => ({
                  ...s,
                  artist: s.artist ?? '',
                  duration_sec: s.duration_sec ?? 0,
                })),
                index,
              );
              playSong({ ...item, artist: item.artist ?? '', duration_sec: item.duration_sec ?? 0 }, url, id);
            }}
            hideArtist={false}
          />
        )}
        contentContainerStyle={{ paddingBottom: 160 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
              Tracks will appear here once discovery runs.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  back: { fontSize: 24, marginTop: 4 },
  titleBlock: { flex: 1 },
  slot: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '600', letterSpacing: -0.015, lineHeight: 30 },
  pauseBtn: { borderWidth: 1, borderRadius: 100, paddingVertical: 6, paddingHorizontal: 12, marginTop: 6 },
  pauseText: { fontSize: 12, fontWeight: '500' },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
