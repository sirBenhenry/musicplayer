import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { SongRow } from '../../components/shared/SongRow';
import { getSongs, getStreamUrl, searchNewArtists, importArtist, searchTracks, downloadTrack } from '../../lib/api';
import { playSong } from '../../lib/audio';
import { radius } from '../../lib/tokens';

type Tab = 'library' | 'artists' | 'songs';

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('library');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);

  const doSearch = async (q: string, activeTab: Tab = tab) => {
    setQuery(q);
    setResults([]);
    if (q.length < 2) return;
    setLoading(true);
    try {
      if (activeTab === 'library') {
        setResults(await getSongs({ search: q, limit: '40' }));
      } else if (activeTab === 'artists') {
        setResults(await searchNewArtists(q));
      } else {
        setResults(await searchTracks(q));
      }
    } catch { setResults([]); }
    setLoading(false);
  };

  const onTabChange = (t: Tab) => {
    setTab(t);
    setResults([]);
    if (query.length >= 2) doSearch(query, t);
  };

  const handleImportArtist = async (artist: any) => {
    setActioning(artist.mbid);
    try {
      await importArtist({ mbid: artist.mbid, name: artist.name });
      Alert.alert('Queued', `Downloading discography for ${artist.name}. Check back in a few minutes.`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Import failed');
    } finally { setActioning(null); }
  };

  const handleDownloadTrack = async (track: any) => {
    const key = `${track.artist}/${track.title}`;
    setActioning(key);
    try {
      await downloadTrack({ title: track.title, artist: track.artist });
      Alert.alert('Queued', `Searching for "${track.title}" by ${track.artist}`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Download failed');
    } finally { setActioning(null); }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'library', label: 'Library' },
    { key: 'artists', label: 'Artists' },
    { key: 'songs', label: 'Songs' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>Search</Text>

        <View style={[styles.tabs, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, tab === t.key && { backgroundColor: theme.accent }]}
              onPress={() => onTabChange(t.key)}
            >
              <Text style={[styles.tabLabel, { color: tab === t.key ? theme.onAccent : theme.fgMuted }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.inputWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.searchIcon, { color: theme.fgSoft }]}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={doSearch}
            placeholder={
              tab === 'library' ? 'Search your songs…' :
              tab === 'artists' ? 'Search artists to add…' :
              'Search songs to download…'
            }
            placeholderTextColor={theme.fgSoft}
            style={[styles.input, { color: theme.fg }]}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {loading && <ActivityIndicator size="small" color={theme.accent} />}
          {!loading && query.length > 0 && (
            <TouchableOpacity onPress={() => doSearch('')} hitSlop={8}>
              <Text style={{ color: theme.fgSoft, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {tab === 'library' && (
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
      )}

      {tab === 'artists' && (
        <FlatList
          data={results}
          keyExtractor={(a) => a.mbid}
          renderItem={({ item }) => (
            <View style={[styles.row, { borderBottomColor: theme.border }]}>
              <View style={styles.info}>
                <Text style={[styles.rowTitle, { color: theme.fg }]}>{item.name}</Text>
                {item.genres?.length > 0 && (
                  <Text style={[styles.rowSub, { color: theme.fgMuted }]}>
                    {item.genres.slice(0, 3).join(' · ')}
                  </Text>
                )}
                {item.overview ? (
                  <Text style={[styles.rowBio, { color: theme.fgSoft }]} numberOfLines={2}>
                    {item.overview}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: theme.accentBg, borderColor: theme.accentTint }]}
                onPress={() => handleImportArtist(item)}
                disabled={actioning === item.mbid}
              >
                {actioning === item.mbid
                  ? <ActivityIndicator size="small" color={theme.accent} />
                  : <Text style={[styles.actionBtnText, { color: theme.accent }]}>+ Add</Text>}
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
                {query.length === 0 ? 'Search for artists to add their music' : 'No artists found'}
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 160 }}
        />
      )}

      {tab === 'songs' && (
        <FlatList
          data={results}
          keyExtractor={(t) => `${t.artist}/${t.title}`}
          renderItem={({ item }) => {
            const key = `${item.artist}/${item.title}`;
            return (
              <View style={[styles.row, { borderBottomColor: theme.border }]}>
                <View style={styles.info}>
                  <Text style={[styles.rowTitle, { color: theme.fg }]}>{item.title}</Text>
                  <Text style={[styles.rowSub, { color: theme.fgMuted }]}>
                    {item.artist}{item.album ? ` · ${item.album}` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: theme.accentBg, borderColor: theme.accentTint }]}
                  onPress={() => handleDownloadTrack(item)}
                  disabled={actioning === key}
                >
                  {actioning === key
                    ? <ActivityIndicator size="small" color={theme.accent} />
                    : <Text style={[styles.actionBtnText, { color: theme.accent }]}>↓</Text>}
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
                {query.length === 0 ? 'Search for songs to download individually' : 'No songs found'}
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
  tabLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 3, gap: 8 },
  searchIcon: { fontSize: 20 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  info: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  rowSub: { fontSize: 12, marginBottom: 2 },
  rowBio: { fontSize: 12, lineHeight: 17 },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, minWidth: 50, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
});
