import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { Icon } from '../../components/shared/Icon';
import { SongRow } from '../../components/shared/SongRow';
import { TextInputModal } from '../../components/shared/TextInputModal';
import { getUserPlaylist, renameUserPlaylist, removeSongFromPlaylist, getStreamUrl } from '../../lib/api';
import { playSong, addToQueue } from '../../lib/audio';

export default function UserPlaylistScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<any>(null);
  const [renameVisible, setRenameVisible] = useState(false);

  const reload = () => {
    if (!id) return;
    getUserPlaylist(id).then(setPlaylist).catch(() => {});
  };

  useEffect(() => { reload(); }, [id]);

  const handleRemoveSong = (songId: string, title: string) => {
    Alert.alert('Remove song', `Remove "${title}" from this playlist?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          if (!id) return;
          try {
            const updated = await removeSongFromPlaylist(id, songId);
            setPlaylist(updated);
          } catch {}
        },
      },
    ]);
  };

  const songs: any[] = playlist?.songs ?? [];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.titleBlock} onLongPress={() => setRenameVisible(true)} hitSlop={8} activeOpacity={0.8}>
          <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={1}>
            {playlist?.name ?? '…'}
          </Text>
          <Text style={[styles.meta, { color: theme.fgMuted }]}>{songs.length} songs · hold to rename</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={songs}
        keyExtractor={(s, i) => s.id ?? String(i)}
        renderItem={({ item, index }) => (
          <SongRow
            song={{ id: item.id, title: item.title, artist: item.artist, duration_sec: item.duration_sec }}
            index={index}
            onPress={() => {
              if (!item.navidrome_id) return;
              const url = getStreamUrl(item.navidrome_id);
              playSong({ ...item, duration_sec: item.duration_sec ?? 0 }, url, id);
            }}
            onSwipeQueue={() => addToQueue({ ...item, navidrome_id: item.navidrome_id ?? '', duration_sec: item.duration_sec ?? 0 })}
            onLongPress={() => handleRemoveSong(item.id, item.title)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
              No songs yet. Long-press any song in your library to add it.
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 160 }}
      />

      <TextInputModal
        visible={renameVisible}
        title="Rename playlist"
        defaultValue={playlist?.name ?? ''}
        confirmLabel="Rename"
        onCancel={() => setRenameVisible(false)}
        onConfirm={async (name) => {
          setRenameVisible(false);
          if (!id) return;
          try {
            const updated = await renameUserPlaylist(id, name);
            setPlaylist(updated);
          } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Rename failed');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  back: { fontSize: 24, marginTop: 4 },
  titleBlock: { flex: 1 },
  title: { fontSize: 24, fontWeight: '600', letterSpacing: -0.015, lineHeight: 30 },
  meta: { fontSize: 12, marginTop: 4 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
