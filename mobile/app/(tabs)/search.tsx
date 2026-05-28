import React, { useState, useRef } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { CoverArt } from '../../components/shared/CoverArt';
import { Icon } from '../../components/shared/Icon';
import { ArtistImportModal } from '../../components/shared/ArtistImportModal';
import { ProfilePickerModal } from '../../components/shared/ProfilePickerModal';
import { getArtists, searchNewArtists, searchTracks, downloadTrack } from '../../lib/api';
import { font, radius } from '../../lib/tokens';

type Tab = 'artists' | 'songs';
type SongFilter = 'all' | 'no_live' | 'no_remixes' | 'studio';

const SONG_FILTERS: { key: SongFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'no_live', label: 'No live' },
  { key: 'no_remixes', label: 'No remixes' },
  { key: 'studio', label: 'Studio' },
];

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('songs');
  const [liveFilter, setLiveFilter] = useState<SongFilter>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<any | null>(null);
  const [pendingDownload, setPendingDownload] = useState<any | null>(null);
  const [libraryOnly, setLibraryOnly] = useState(false);
  const [libraryArtistNames, setLibraryArtistNames] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    getArtists({ followed: 'true' }).then(a => setLibraryArtistNames(new Set(a.map((x: any) => x.name.toLowerCase())))).catch(() => {});
  }, []);
  const currentQuery = useRef('');
  const currentFilter = useRef<SongFilter>('all');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = async (q: string, activeTab: Tab, filter: SongFilter) => {
    try {
      const res: any[] = activeTab === 'artists'
        ? await searchNewArtists(q)
        : await searchTracks(q, filter);
      if (q === currentQuery.current && filter === currentFilter.current) {
        setResults(res);
        setLoading(false);
      }
    } catch {
      if (q === currentQuery.current && filter === currentFilter.current) {
        setResults([]);
        setLoading(false);
      }
    }
  };

  const doSearch = (q: string, activeTab: Tab = tab, filter: SongFilter = liveFilter) => {
    setQuery(q);
    currentQuery.current = q;
    currentFilter.current = filter;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setResults([]);
    if (q.length < 2) { setLoading(false); return; }
    setLoading(true);
    debounceTimer.current = setTimeout(() => runSearch(q, activeTab, filter), 350);
  };

  const onTabChange = (t: Tab) => {
    setTab(t);
    setResults([]);
    if (query.length >= 2) doSearch(query, t, liveFilter);
  };

  const onFilterChange = (f: SongFilter) => {
    setLiveFilter(f);
    if (query.length >= 2) doSearch(query, tab, f);
  };

  const handleImported = (artist: any) => {
    Alert.alert('Queued', `Download queued for ${artist.name}. Check back in a few minutes.`);
  };

  const handleDownloadTrack = async (track: any, profileId?: string) => {
    const key = `${track.artist}/${track.title}`;
    setActioning(key);
    try {
      await downloadTrack({
        title: track.title,
        artist: track.artist,
        mb_recording_id: track.mb_recording_id || undefined,
        profile_id: profileId,
      });
      Alert.alert('Queued', `Searching for "${track.title}" by ${track.artist}`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Download failed');
    } finally { setActioning(null); }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'songs', label: 'Songs' },
    { key: 'artists', label: 'Artists' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={[styles.headerLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>SEARCH</Text>
          <Text style={[styles.heading, { color: theme.fgStrong, fontFamily: font.display }]}>
            What are you looking for?
          </Text>
        </View>

        <View style={[styles.inputWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Icon name="search" color={theme.fgSoft} size={18} />
          <TextInput
            value={query}
            onChangeText={doSearch}
            placeholder={tab === 'artists' ? 'Search artists to add…' : 'Search songs to download…'}
            placeholderTextColor={theme.fgSoft}
            style={[styles.input, { color: theme.fg }]}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {loading && <ActivityIndicator size="small" color={theme.accent} />}
          {!loading && query.length > 0 && (
            <Pressable onPress={() => doSearch('')} hitSlop={8}>
              <Icon name="close" color={theme.fgSoft} size={18} />
            </Pressable>
          )}
        </View>

        <View style={styles.tabRow}>
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                style={[
                  styles.tabPill,
                  {
                    backgroundColor: active ? theme.fgStrong : 'transparent',
                    borderColor: active ? 'transparent' : theme.border,
                  },
                ]}
                onPress={() => onTabChange(t.key)}
              >
                <Text style={[styles.tabLabel, { color: active ? theme.bg : theme.fgMuted }]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tab === 'artists' && (
        <>
          <FlatList
            data={results}
            keyExtractor={(a) => a.mbid}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.artistRow, { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => setSelectedArtist(item)}
              >
                <CoverArt
                  uri={item.image_url ?? null}
                  size={52}
                  title={item.name}
                  borderRadius={radius.card}
                />
                <View style={styles.info}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.rowTitle, { color: theme.fgStrong }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.ended && (
                      <View style={[styles.endedBadge, { backgroundColor: theme.bgElev, borderColor: theme.border }]}>
                        <Text style={[styles.endedText, { color: theme.fgMuted }]}>ended</Text>
                      </View>
                    )}
                  </View>
                  {item.disambiguation ? (
                    <Text style={[styles.rowDisambig, { color: theme.fgMuted }]} numberOfLines={1}>
                      {item.disambiguation}
                    </Text>
                  ) : null}
                  {item.genres?.length > 0 && (
                    <Text style={[styles.rowSub, { color: theme.fgSoft }]} numberOfLines={1}>
                      {item.genres.slice(0, 3).join(' · ')}
                    </Text>
                  )}
                </View>
                <Icon name="chevronRight" color={theme.fgSoft} size={18} />
              </Pressable>
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
          <ArtistImportModal
            artist={selectedArtist}
            onClose={() => setSelectedArtist(null)}
            onImported={(a) => { setSelectedArtist(null); handleImported(a); }}
          />
        </>
      )}

      {tab === 'songs' && (
        <>
          <View style={[styles.filterRow, { borderBottomColor: theme.borderSoft }]}>
            {SONG_FILTERS.map(f => (
              <Pressable
                key={f.key}
                onPress={() => onFilterChange(f.key)}
                style={[
                  styles.filterChip,
                  liveFilter === f.key
                    ? { backgroundColor: theme.accent }
                    : { backgroundColor: theme.bgElev, borderColor: theme.borderSoft },
                ]}
              >
                <Text style={[
                  styles.filterChipText,
                  { color: liveFilter === f.key ? theme.onAccent : theme.fgMuted },
                ]}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setLibraryOnly(v => !v)}
              style={[
                styles.filterChip,
                libraryOnly
                  ? { backgroundColor: theme.accent }
                  : { backgroundColor: theme.bgElev, borderColor: theme.borderSoft },
              ]}
            >
              <Text style={[styles.filterChipText, { color: libraryOnly ? theme.onAccent : theme.fgMuted }]}>
                My artists
              </Text>
            </Pressable>
          </View>
          <FlatList
            data={libraryOnly
              ? results.filter(r => libraryArtistNames.has((r.artist || '').toLowerCase()))
              : results}
            keyExtractor={(t) => t.mb_recording_id || `${t.artist}/${t.title}`}
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
                  <Pressable
                    style={[styles.actionBtn, { backgroundColor: theme.accentBg, borderColor: theme.accentTint }]}
                    onPress={() => setPendingDownload(item)}
                    disabled={actioning === key}
                  >
                    {actioning === key
                      ? <ActivityIndicator size="small" color={theme.accent} />
                      : <Icon name="download" color={theme.accent} size={18} />}
                  </Pressable>
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
        </>
      )}

      <ProfilePickerModal
        visible={pendingDownload !== null}
        songTitle={pendingDownload ? `${pendingDownload.title} — ${pendingDownload.artist}` : ''}
        onClose={() => setPendingDownload(null)}
        onPick={(profileId) => {
          const track = pendingDownload;
          setPendingDownload(null);
          handleDownloadTrack(track, profileId ?? undefined);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginBottom: 4 },
  heading: { fontSize: 30, lineHeight: 34, letterSpacing: -0.015, marginBottom: 16 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 3, gap: 8, marginBottom: 10 },
  input: { flex: 1, fontSize: 15, paddingVertical: 10 },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  tabPill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 100, borderWidth: 1 },
  tabLabel: { fontSize: 13.5, fontWeight: '500' },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  artistRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  endedBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1 },
  endedText: { fontSize: 9.5, fontWeight: '600' },
  info: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  rowDisambig: { fontSize: 12.5, marginTop: 1 },
  rowSub: { fontSize: 11.5, marginTop: 1 },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, minWidth: 50, alignItems: 'center' },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  filterRow: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  filterChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1 },
  filterChipText: { fontSize: 12, fontWeight: '600' },
});
