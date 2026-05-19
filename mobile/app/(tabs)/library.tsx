import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { SongRow } from '../../components/shared/SongRow';
import { CoverArt } from '../../components/shared/CoverArt';
import { getSongs, getArtists, getAlbums, getStreamUrl } from '../../lib/api';
import { playSong } from '../../lib/audio';
import { font, radius } from '../../lib/tokens';

type Tab = 'Songs' | 'Artists' | 'Albums';

export default function LibraryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfileId } = useStore();

  const [tab, setTab] = useState<Tab>('Songs');
  const [songs, setSongs] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);

  useEffect(() => {
    getSongs(activeProfileId ? { profile: activeProfileId } : {}).then(setSongs).catch(() => {});
    getArtists().then(setArtists).catch(() => {});
    getAlbums().then(setAlbums).catch(() => {});
  }, [activeProfileId]);

  const TABS: Tab[] = ['Songs', 'Artists', 'Albums'];

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
              song={item}
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

      {tab === 'Albums' && (
        <FlatList
          data={albums}
          keyExtractor={(a) => a.id}
          numColumns={2}
          renderItem={({ item }) => (
            <View style={styles.albumItem}>
              <CoverArt uri={item.cover_url} size={160} title={item.title} />
              <Text style={[styles.albumTitle, { color: theme.fgStrong }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.albumArtist, { color: theme.fgMuted }]} numberOfLines={1}>
                {item.artist_name ?? ''}
              </Text>
            </View>
          )}
          contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 160 }}
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
  albumItem: { flex: 1, padding: 4 },
  albumTitle: { fontSize: 13, fontWeight: '500', marginTop: 8, lineHeight: 18 },
  albumArtist: { fontSize: 12, marginTop: 2 },
});
