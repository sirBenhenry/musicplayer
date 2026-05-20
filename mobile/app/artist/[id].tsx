import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { CoverArt } from '../../components/shared/CoverArt';
import { SongRow } from '../../components/shared/SongRow';
import { getArtist, getSongs, followArtist, unfollowArtist, getStreamUrl, getCoverUrl, downloadAllArtist } from '../../lib/api';
import { playSong } from '../../lib/audio';

export default function ArtistScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [artist, setArtist] = useState<any>(null);
  const [songs, setSongs] = useState<any[]>([]);
  const [followed, setFollowed] = useState(false);

  useEffect(() => {
    if (!id) return;
    getArtist(id).then((a) => { setArtist(a); setFollowed(a.followed); }).catch(() => {});
    getSongs({ artist: id }).then(setSongs).catch(() => {});
  }, [id]);

  const handleDownloadAll = async () => {
    if (!id) return;
    try {
      await downloadAllArtist(id);
      Alert.alert('Queued', `Downloading all available music from ${artist?.name}`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Download failed');
    }
  };

  const toggleFollow = async () => {
    if (!id) return;
    if (followed) {
      await unfollowArtist(id);
      setFollowed(false);
    } else {
      await followArtist(id);
      setFollowed(true);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: theme.fgStrong }]}>←</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={songs}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={() => (
          <View style={styles.artistHeader}>
            <CoverArt uri={artist ? getCoverUrl(artist.navidrome_id) : null} size={80} title={artist?.name} borderRadius={40} />
            <Text style={[styles.name, { color: theme.fgStrong }]}>{artist?.name}</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity
                onPress={toggleFollow}
                style={[
                  styles.followBtn,
                  { backgroundColor: followed ? theme.accentBg : theme.accent, borderColor: followed ? theme.accentTint : 'transparent' },
                ]}
              >
                <Text style={{ color: followed ? theme.accent : theme.onAccent, fontSize: 14, fontWeight: '600' }}>
                  {followed ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDownloadAll}
                style={[styles.downloadBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <Text style={{ color: theme.fgMuted, fontSize: 14, fontWeight: '600' }}>↓ All</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.sectionHead, { color: theme.fgStrong }]}>Songs</Text>
          </View>
        )}
        renderItem={({ item, index }) => (
          <SongRow
            song={{ ...item, artist: artist?.name ?? '' }}
            index={index}
            hideArtist
            onPress={() => {
              const url = getStreamUrl(item.navidrome_id);
              playSong({ ...item, artist: artist?.name ?? '', duration_sec: item.duration_sec ?? 0 }, url, null);
            }}
          />
        )}
        contentContainerStyle={{ paddingBottom: 160 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  back: { fontSize: 24 },
  artistHeader: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  name: { fontSize: 26, fontWeight: '700', letterSpacing: -0.02, textAlign: 'center' },
  actionRow: { flexDirection: 'row', gap: 10 },
  followBtn: { borderRadius: 100, paddingVertical: 10, paddingHorizontal: 24, borderWidth: 1 },
  downloadBtn: { borderRadius: 100, paddingVertical: 10, paddingHorizontal: 20, borderWidth: 1 },
  sectionHead: { fontSize: 18, fontWeight: '600', letterSpacing: -0.01, alignSelf: 'flex-start', marginTop: 8 },
});
