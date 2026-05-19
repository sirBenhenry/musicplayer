import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { getHistory } from '../lib/api';
import { font } from '../lib/tokens';

const SLOT_LABELS: Record<string, string> = {
  close: 'Close Match',
  broader: 'Broader Taste',
  genre: 'New Genre',
  artist: 'Artist of the Day',
};

export default function HistoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    getHistory(30).then(setHistory).catch(() => {});
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: theme.fgStrong }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>History</Text>
      </View>

      <FlatList
        data={history}
        keyExtractor={(h) => h.id}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: theme.borderSoft }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.date, { color: theme.fgMuted, fontFamily: font.mono }]}>
                {item.date} · {SLOT_LABELS[item.slot] ?? item.slot}
              </Text>
              {item.genre && (
                <Text style={[styles.genre, { color: theme.fgStrong }]}>{item.genre}</Text>
              )}
              <Text style={[styles.count, { color: theme.fgMuted }]}>
                {(item.tracklist ?? []).length} tracks
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: theme.fgMuted }}>No history yet.</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 16, paddingBottom: 16 },
  back: { fontSize: 24 },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.02 },
  row: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  date: { fontSize: 11, letterSpacing: 0.06, marginBottom: 3 },
  genre: { fontSize: 15, fontWeight: '500' },
  count: { fontSize: 12, marginTop: 2 },
  empty: { padding: 40, alignItems: 'center' },
});
