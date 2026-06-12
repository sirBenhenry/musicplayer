import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { Icon } from '../../components/shared/Icon';
import { CoverArt } from '../../components/shared/CoverArt';
import { SongRow } from '../../components/shared/SongRow';
import { getArtist, getSongs, addArtist, followArtist, unfollowArtist, getStreamUrl, getCoverUrl, downloadAllArtist } from '../../lib/api';
import { playSong, addToQueue } from '../../lib/audio';

export default function ArtistScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [artist, setArtist] = useState<any>(null);
  const [songs, setSongs] = useState<any[]>([]);
  // followed = in library (Add or Follow); monitored = has Lidarr monitoring (Follow only)
  const [followed, setFollowed] = useState(false);
  const [monitored, setMonitored] = useState(false);

  useEffect(() => {
    if (!id) return;
    getArtist(id).then((a) => {
      setArtist(a);
      setFollowed(a.followed);
      setMonitored(a.monitored ?? false);
    }).catch(() => {});
    getSongs({ artist: id, limit: '500' }).then(setSongs).catch(() => {});
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

  // Add: library only, no Lidarr monitoring
  const handleAdd = async () => {
    if (!id) return;
    setFollowed(true); // optimistic
    try {
      await addArtist(id);
    } catch {
      setFollowed(false);
    }
  };

  // Follow: library + Lidarr monitoring
  const handleFollow = async () => {
    if (!id) return;
    setFollowed(true);
    setMonitored(true); // optimistic
    try {
      await followArtist(id);
    } catch {
      setFollowed(false);
      setMonitored(false);
    }
  };

  // Unfollow/unadd: works for both states (backend skips Lidarr removal if no lidarr_id)
  const handleUnfollow = async () => {
    if (!id) return;
    const prevFollowed = followed;
    const prevMonitored = monitored;
    setFollowed(false);
    setMonitored(false); // optimistic
    try {
      await unfollowArtist(id);
    } catch {
      setFollowed(prevFollowed);
      setMonitored(prevMonitored);
    }
  };

  // States:
  // !followed               → [Add] [Follow] [⬇]
  // followed && !monitored  → [Added] (tap=unadd) [Follow] [⬇]
  // followed && monitored   → [Following] (tap=unfollow) [⬇]

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
        </Pressable>
      </View>

      <FlatList
        data={songs}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={() => (
          <View style={styles.artistHeader}>
            <CoverArt uri={artist ? getCoverUrl(artist.navidrome_id) : null} size={80} title={artist?.name} borderRadius={40} />
            <Text style={[styles.name, { color: theme.fgStrong }]}>{artist?.name}</Text>
            <View style={styles.actionRow}>
              {/* Not in library at all */}
              {!followed && (
                <Pressable onPress={handleAdd} style={[styles.btn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Text style={[styles.btnText, { color: theme.fgStrong }]}>Add to Library</Text>
                </Pressable>
              )}

              {/* In library but no monitoring — "In Library" shows current state, tap removes */}
              {followed && !monitored && (
                <Pressable onPress={handleUnfollow} style={[styles.btn, { backgroundColor: theme.bgElev, borderColor: theme.borderSoft }]}>
                  <Text style={[styles.btnText, { color: theme.fgMuted }]}>In Library  ✕</Text>
                </Pressable>
              )}

              {/* Follow (when not monitoring) — prominent CTA */}
              {!monitored && (
                <Pressable onPress={handleFollow} style={[styles.btn, { backgroundColor: theme.accent, borderColor: 'transparent' }]}>
                  <Text style={[styles.btnText, { color: theme.onAccent }]}>Follow</Text>
                </Pressable>
              )}

              {/* Following — monitoring active, tap to unfollow */}
              {monitored && (
                <Pressable onPress={handleUnfollow} style={[styles.btn, { backgroundColor: theme.accent, borderColor: 'transparent' }]}>
                  <Text style={[styles.btnText, { color: theme.onAccent }]}>Following  ✕</Text>
                </Pressable>
              )}

              {/* Download all */}
              <Pressable onPress={handleDownloadAll} style={[styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Icon name="download" color={theme.fgMuted} size={16} />
              </Pressable>
            </View>
            <Text style={[styles.sectionHead, { color: theme.fgStrong }]}>Songs</Text>
          </View>
        )}
        renderItem={({ item, index }) => (
          <SongRow
            song={{ ...item, artist: artist?.name ?? '' }}
            index={index}
            hideArtist
            onSwipeQueue={() => addToQueue({ ...item, artist: artist?.name ?? '', duration_sec: item.duration_sec ?? 0 })}
            onPress={() => {
              const url = getStreamUrl(item.navidrome_id);
              const ctx = songs.map((s) => ({
                ...s,
                artist: artist?.name ?? '',
                duration_sec: s.duration_sec ?? 0,
              }));
              playSong({ ...item, artist: artist?.name ?? '', duration_sec: item.duration_sec ?? 0 }, url, null, ctx);
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
  artistHeader: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  name: { fontSize: 26, fontWeight: '700', letterSpacing: -0.02, textAlign: 'center' },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  btn: { borderRadius: 100, paddingVertical: 10, paddingHorizontal: 22, borderWidth: 1 },
  btnText: { fontSize: 14, fontWeight: '600' },
  iconBtn: { borderRadius: 100, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1 },
  sectionHead: { fontSize: 18, fontWeight: '600', letterSpacing: -0.01, alignSelf: 'flex-start', marginTop: 8 },
});
