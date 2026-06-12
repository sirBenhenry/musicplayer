import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { Icon } from '../components/shared/Icon';
import { getPendingDeletions, rescueSong } from '../lib/api';
import { font } from '../lib/tokens';

export default function DeletionScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pending, setPending] = useState<any[]>([]);

  useFocusEffect(useCallback(() => {
    getPendingDeletions().then(setPending).catch(() => {});
  }, []));

  const rescue = async (songId: string) => {
    try {
      await rescueSong(songId);
      setPending((prev) => prev.filter((p) => p.song_id !== songId));
    } catch {}
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
        </Pressable>
        <View>
          <Text style={[styles.headerLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>SKIPPED TODAY</Text>
          <Text style={[styles.heading, { color: theme.fgStrong, fontFamily: font.display }]}>Pending deletion</Text>
          <Text style={[styles.sub, { color: theme.fgMuted }]}>
            {pending.length} track{pending.length !== 1 ? 's' : ''} · removed at end of day
          </Text>
        </View>
      </View>

      <FlatList
        data={pending}
        keyExtractor={(p) => p.song_id}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: theme.borderSoft }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: theme.fgStrong }]} numberOfLines={1}>
                {item.title || '—'}
              </Text>
              <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
                {item.artist_name || 'Unknown artist'}
              </Text>
            </View>
            <Pressable
              onPress={() => rescue(item.song_id)}
              style={({ pressed }) => [
                styles.rescueBtn,
                { backgroundColor: theme.accentBg, borderColor: theme.accentTint, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.rescueText, { color: theme.accent }]}>Keep</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="check" color={theme.fgFaint} size={28} />
            <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
              Nothing marked for deletion today.{'\n'}Skipped daily-playlist songs land here.
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
  headerLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginBottom: 4 },
  heading: { fontSize: 26, lineHeight: 30, letterSpacing: -0.015 },
  sub: { fontSize: 13, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  title: { fontSize: 15, fontWeight: '500' },
  artist: { fontSize: 13, marginTop: 1 },
  rescueBtn: { borderWidth: 1, borderRadius: 100, paddingVertical: 6, paddingHorizontal: 14 },
  rescueText: { fontSize: 13, fontWeight: '600' },
  empty: { padding: 40, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
