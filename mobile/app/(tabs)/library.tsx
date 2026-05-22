import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { SongRow } from '../../components/shared/SongRow';
import { CoverArt } from '../../components/shared/CoverArt';
import { getSongs, getArtists, getPlaylists, getStreamUrl, getCoverUrl } from '../../lib/api';
import { playSong } from '../../lib/audio';
import { font, radius } from '../../lib/tokens';

type Tab = 'Songs' | 'Artists' | 'Playlists';

const SLOT_LABEL: Record<string, string> = {
  close_match: 'Close Match',
  broader_taste: 'Broader Taste',
  new_genre: 'New Genre',
  artist_of_day: 'Artist of the Day',
};

export default function LibraryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfileId } = useStore();

  const [tab, setTab] = useState<Tab>('Songs');
  const [songs, setSongs] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);

  useEffect(() => {
    getSongs({}).then(setSongs).catch(() => {});
    getArtists().then(setArtists).catch(() => {});
    getPlaylists(activeProfileId ?? undefined).then(setPlaylists).catch(() => {});
  }, [activeProfileId]);

  const TABS: Tab[] = ['Songs', 'Artists', 'Playlists'];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>Library</Text>
        <View style={[styles.tabs, { backgroundColor: theme.bgElev }]}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tabBtn, tab === t && { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text style={[styles.tabText, { color: tab === t ? theme.fgStrong : theme.fgMuted }]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'Songs' && (
        <FlatList
          data={songs}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <SongRow
              song={{ ...item, artist: item.artist_name ?? '', cover_url: getCoverUrl(item.navidrome_id) }}
              onPress={() => {
                const url = getStreamUrl(item.navidrome_id);
                playSong({ ...item, artist: item.artist_name ?? '', duration_sec: item.duration_sec ?? 0 }, url, null);
              }}
            />
          )}
          contentContainerStyle={{ paddingBottom: 160 }}
        />
      )}

      {tab === 'Artists' && (
        <FlatList
          data={artists}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/artist/${item.id}`)}
              style={[styles.artistRow, { borderBottomColor: theme.borderSoft }]}
              activeOpacity={0.7}
            >
              <CoverArt uri={null} size={44} title={item.name} borderRadius={22} />
              <Text style={[styles.artistName, { color: theme.fgStrong }]} numberOfLines={1}>
                {item.name}
              </Text>
              {item.followed && (
                <View style={[styles.followedBadge, { backgroundColor: theme.accentBg }]}>
                  <Text style={[styles.followedText, { color: theme.accent }]}>Following</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingBottom: 160 }}
        />
      )}

      {tab === 'Playlists' && (
        <FlatList
          data={playlists}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/playlist/${item.id}`)}
              style={[styles.playlistRow, { borderBottomColor: theme.borderSoft }]}
              activeOpacity={0.7}
            >
              <View style={[styles.slotBadge, { backgroundColor: theme.accentBg }]}>
                <Text style={[styles.slotText, { color: theme.accent, fontFamily: font.mono }]}>
                  {(SLOT_LABEL[item.slot] ?? item.slot).toUpperCase()}
                </Text>
              </View>
              <View style={styles.playlistInfo}>
                <Text style={[styles.playlistDate, { color: theme.fgStrong }]}>{item.date}</Text>
                <Text style={[styles.playlistMeta, { color: theme.fgMuted }]}>
                  {item.song_count} songs
                  {item.paused_to_tomorrow ? ' · paused' : ''}
                </Text>
              </View>
              <Text style={{ color: theme.fgSoft, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.fgMuted }]}>
              No playlists yet. They're generated daily by the discovery pipeline.
            </Text>
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
  tabs: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, gap: 2 },
  tabBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: 'transparent' },
  tabText: { fontSize: 13.5, fontWeight: '500' },
  artistRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  artistName: { flex: 1, fontSize: 15, fontWeight: '500' },
  followedBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  followedText: { fontSize: 11.5, fontWeight: '600' },
  playlistRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  slotBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  slotText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.1 },
  playlistInfo: { flex: 1 },
  playlistDate: { fontSize: 15, fontWeight: '500' },
  playlistMeta: { fontSize: 12, marginTop: 2 },
  empty: { fontSize: 14, textAlign: 'center', marginTop: 60, paddingHorizontal: 40, lineHeight: 22 },
});
