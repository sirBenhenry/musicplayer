import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { SongRow } from '../../components/shared/SongRow';
import { getSongs, getStreamUrl } from '../../lib/api';
import { playSong } from '../../lib/audio';
import { font, radius } from '../../lib/tokens';

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);

  const doSearch = async (q: string) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    try {
      const songs = await getSongs({ search: q, limit: '40' });
      setResults(songs);
    } catch { setResults([]); }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>Search</Text>
        <View style={[styles.inputWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.searchIcon, { color: theme.fgSoft }]}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={doSearch}
            placeholder="Artists, songs, albums…"
            placeholderTextColor={theme.fgSoft}
            style={[styles.input, { color: theme.fg }]}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => doSearch('')} hitSlop={8}>
              <Text style={{ color: theme.fgSoft, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <SongRow
            song={item}
            onPress={() => {
              const url = getStreamUrl(item.navidrome_id);
              playSong({ ...item, artist: item.artist_name ?? '', duration_sec: item.duration_sec ?? 0 }, url, null);
            }}
          />
        )}
        ListEmptyComponent={
          query.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
                Search your library
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 160 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  heading: { fontSize: 28, fontWeight: '700', letterSpacing: -0.02, marginBottom: 16 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 3, gap: 8 },
  searchIcon: { fontSize: 20 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 15 },
});
