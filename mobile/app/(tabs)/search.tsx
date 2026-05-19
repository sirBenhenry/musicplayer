import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { SongRow } from '../../components/shared/SongRow';
import { getSongs, getStreamUrl, searchNewArtists, importArtist } from '../../lib/api';
import { playSong } from '../../lib/audio';
import { font, radius } from '../../lib/tokens';

type Tab = 'library' | 'discover';

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('library');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [importing, setImporting] = useState<string | null>(null);

  const doSearch = async (q: string) => {
    setQuery(q);
    setResults([]);
    if (q.length < 2) return;
    try {
      if (tab === 'library') {
        const songs = await getSongs({ search: q, limit: '40' });
        setResults(songs);
      } else {
        const artists = await searchNewArtists(q);
        setResults(artists);
      }
    } catch { setResults([]); }
  };

  const onTabChange = (t: Tab) => {
    setTab(t);
    setResults([]);
    if (query.length >= 2) {
      setTimeout(() => doSearch(query), 0);
    }
  };

  const handleImport = async (artist: any) => {
    setImporting(artist.mbid);
    try {
      await importArtist({ mbid: artist.mbid, name: artist.name });
      Alert.alert('Queued', `Downloading discography for ${artist.name}. Check back in a few minutes.`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Import failed');
    } finally {
      setImporting(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>Search</Text>

        {/* Tab switcher */}
        <View style={[styles.tabs, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {(['library', 'discover'] as Tab[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && { backgroundColor: theme.accent }]}
              onPress={() => onTabChange(t)}
            >
              <Text style={[styles.tabLabel, { color: tab === t ? theme.onAccent : theme.fgMuted }]}>
                {t === 'library' ? 'My Library' : 'Discover'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.inputWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.searchIcon, { color: theme.fgSoft }]}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={doSearch}
            placeholder={tab === 'library' ? 'Artists, songs, albums…' : 'Search artists to add…'}
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

      {tab === 'library' ? (
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
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
                {query.length === 0 ? 'Search your library' : 'No results'}
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 160 }}
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(a) => a.mbid}
          renderItem={({ item }) => (
            <View style={[styles.artistRow, { borderBottomColor: theme.border }]}>
              <View style={styles.artistInfo}>
                <Text style={[styles.artistName, { color: theme.fg }]}>{item.name}</Text>
                {item.genres?.length > 0 && (
                  <Text style={[styles.artistGenre, { color: theme.fgMuted }]}>
                    {item.genres.slice(0, 3).join(' · ')}
                  </Text>
                )}
                {item.overview ? (
                  <Text style={[styles.artistBio, { color: theme.fgSoft }]} numberOfLines={2}>
                    {item.overview}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: theme.accentBg, borderColor: theme.accentTint }]}
                onPress={() => handleImport(item)}
                disabled={importing === item.mbid}
              >
                {importing === item.mbid ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <Text style={[styles.addBtnText, { color: theme.accent }]}>+ Add</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
                {query.length === 0
                  ? 'Search for artists to download their music'
                  : 'No artists found'}
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 160 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  heading: { fontSize: 28, fontWeight: '700', letterSpacing: -0.02, marginBottom: 16 },
  tabs: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, padding: 3, marginBottom: 12, gap: 3 },
  tabBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  tabLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 3, gap: 8 },
  searchIcon: { fontSize: 20 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  artistRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  artistInfo: { flex: 1 },
  artistName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  artistGenre: { fontSize: 12, marginBottom: 4 },
  artistBio: { fontSize: 12, lineHeight: 17 },
  addBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, minWidth: 66, alignItems: 'center' },
  addBtnText: { fontSize: 13, fontWeight: '600' },
});
