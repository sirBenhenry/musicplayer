import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { getPendingDeletions, rescueSong } from '../lib/api';

export default function DeletionScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pending, setPending] = useState<any[]>([]);

  useEffect(() => {
    getPendingDeletions().then(setPending).catch(() => {});
  }, []);

  const rescue = async (songId: string) => {
    await rescueSong(songId);
    setPending((prev) => prev.filter((p) => p.song_id !== songId));
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: theme.fgStrong }]}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={[styles.heading, { color: theme.fgStrong }]}>Pending deletion</Text>
          <Text style={[styles.sub, { color: theme.fgMuted }]}>
            {pending.length} track{pending.length !== 1 ? 's' : ''} · removed at midnight
          </Text>
        </View>
      </View>

      <FlatList
        data={pending}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: theme.borderSoft }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={1}>
                {item.song?.title ?? '—'}
              </Text>
              <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
                {item.song?.artist_name ?? ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => rescue(item.song_id)}
              style={[styles.rescueBtn, { backgroundColor: theme.accentBg, borderColor: theme.accentTint }]}
            >
              <Text style={[styles.rescueText, { color: theme.accent }]}>Keep</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
              Nothing marked for deletion today.
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  back: { fontSize: 24, marginTop: 2 },
  heading: { fontSize: 22, fontWeight: '700', letterSpacing: -0.02 },
  sub: { fontSize: 13, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  title: { fontSize: 15, fontWeight: '500' },
  artist: { fontSize: 13, marginTop: 1 },
  rescueBtn: { borderWidth: 1, borderRadius: 100, paddingVertical: 6, paddingHorizontal: 14 },
  rescueText: { fontSize: 13, fontWeight: '600' },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14 },
});
