import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet, Dimensions
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { CoverArt } from '../../components/shared/CoverArt';
import { getTodayPlaylists, getArtists, getStreamUrl } from '../../lib/api';
import { playSong } from '../../lib/audio';
import { font, radius } from '../../lib/tokens';

const { width: SW } = Dimensions.get('window');

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Late evening';
}

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfileId, profiles } = useStore();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newReleaseArtist, setNewReleaseArtist] = useState<any>(null);

  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const period = greeting().split(' ')[1] ?? 'day';

  useEffect(() => {
    if (!activeProfileId) return;
    getTodayPlaylists(activeProfileId).then(setPlaylists).catch(() => {});
    getArtists({ followed: 'true' }).then((artists: any[]) => {
      const nr = artists.find((a) => a.new_release_flagged_at);
      setNewReleaseArtist(nr ?? null);
    }).catch(() => {});
  }, [activeProfileId]);

  const close = playlists.find((p) => p.slot === 'close');
  const artist = playlists.find((p) => p.slot === 'artist');
  const broader = playlists.find((p) => p.slot === 'broader');
  const genre = playlists.find((p) => p.slot === 'genre');

  const playFirst = (pl: any) => {
    const track = pl?.songs?.find?.((s: any) => s.navidrome_id);
    if (!track) return;
    const url = getStreamUrl(track.navidrome_id);
    playSong({ ...track, artist: track.artist ?? '', duration_sec: track.duration_sec ?? 0 }, url, pl.id);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 160 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={[styles.greetLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
          {greeting().toUpperCase()}
        </Text>
        {profile && (
          <TouchableOpacity style={styles.profileChip} activeOpacity={0.7}>
            <View style={[styles.profileDot, { backgroundColor: `oklch(70% 0.08 ${profile.hue})` }]}>
              <Text style={styles.profileGlyph}>{profile.glyph}</Text>
            </View>
            <Text style={[styles.profileName, { color: theme.fgStrong }]}>{profile.name}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.titleWrap}>
        <Text style={[styles.title, { color: theme.fgStrong }]}>
          {weekday}{' '}
          <Text style={{ color: theme.fgMuted }}>{period}</Text>
        </Text>
      </View>

      {/* New release */}
      {newReleaseArtist && (
        <View style={{ paddingHorizontal: 20, marginBottom: 22 }}>
          <TouchableOpacity
            onPress={() => router.push(`/artist/${newReleaseArtist.id}`)}
            style={[styles.releaseBanner, { backgroundColor: theme.bgElev, borderColor: theme.borderSoft }]}
            activeOpacity={0.8}
          >
            <CoverArt uri={null} size={36} title={newReleaseArtist.name} borderRadius={18} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.releaseLabel}>
                <View style={[styles.dot, { backgroundColor: theme.accent }]} />
                <Text style={[styles.releaseLabelText, { color: theme.accent, fontFamily: font.mono }]}>
                  NEW RELEASE
                </Text>
              </View>
              <Text style={[styles.releaseArtist, { color: theme.fgStrong }]} numberOfLines={1}>
                {newReleaseArtist.name}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>TODAY</Text>

      {/* Hero — Close Match */}
      {close && (
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          <TouchableOpacity
            onPress={() => router.push(`/playlist/${close.id}`)}
            style={[styles.heroCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}
            activeOpacity={0.9}
          >
            <View style={styles.heroImgWrap}>
              <CoverArt uri={null} size={SW - 40} title="Close Match" borderRadius={0} />
              <View style={styles.heroGradient} />
              <View style={styles.heroLabel}>
                <Text style={[styles.heroSlot, { fontFamily: font.mono }]}>CLOSE MATCH</Text>
              </View>
              <View style={styles.heroBottom}>
                <Text style={styles.heroTitle}>Today's picks</Text>
                <TouchableOpacity
                  onPress={() => playFirst(close)}
                  style={styles.heroPlay}
                  hitSlop={8}
                >
                  <Text style={{ fontSize: 20, color: '#1f1a14' }}>▶</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Artist of day */}
      {artist && (
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          <TouchableOpacity
            onPress={() => router.push(`/playlist/${artist.id}`)}
            style={[styles.artistCard, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}
            activeOpacity={0.85}
          >
            <CoverArt uri={null} size={64} title="Artist" borderRadius={32} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.artistSlot, { color: theme.fgMuted, fontFamily: font.mono }]}>
                ARTIST OF THE DAY
              </Text>
              <Text style={[styles.artistName, { color: theme.fgStrong }]} numberOfLines={1}>
                {artist.songs?.[0]?._artist_of_day ?? 'New artist'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Broader + Genre pair */}
      <View style={styles.pair}>
        {[broader, genre].map((pl) =>
          pl ? (
            <TouchableOpacity
              key={pl.id}
              onPress={() => router.push(`/playlist/${pl.id}`)}
              style={{ flex: 1 }}
              activeOpacity={0.85}
            >
              <CoverArt uri={null} size={(SW - 52) / 2} title={pl.slot} />
              <Text style={[styles.pairSlot, { color: theme.fgMuted, fontFamily: font.mono }]}>
                {pl.slot === 'broader' ? 'BROADER' : 'NEW GENRE'}
              </Text>
              <Text style={[styles.pairTitle, { color: theme.fgStrong }]} numberOfLines={1}>
                {pl.songs?.[0]?._genre ?? (pl.slot === 'broader' ? 'Broader taste' : 'New genre')}
              </Text>
            </TouchableOpacity>
          ) : null,
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 4 },
  greetLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500' },
  profileChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 100 },
  profileDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  profileGlyph: { fontSize: 13 },
  profileName: { fontSize: 12.5, fontWeight: '500' },
  titleWrap: { paddingHorizontal: 20, paddingBottom: 22 },
  title: { fontSize: 30, fontWeight: '400', lineHeight: 34, letterSpacing: -0.015 },
  releaseBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, borderWidth: 1 },
  releaseLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  releaseLabelText: { fontSize: 9.5, letterSpacing: 0.12, fontWeight: '500' },
  releaseArtist: { fontSize: 13.5, fontWeight: '500' },
  sectionLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', paddingHorizontal: 20, marginBottom: 14 },
  heroCard: { borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  heroImgWrap: { height: 188, position: 'relative' },
  heroGradient: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', /* gradient not possible inline */ },
  heroLabel: { position: 'absolute', top: 16, left: 16 },
  heroSlot: { fontSize: 10.5, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.12, fontWeight: '500' },
  heroBottom: { position: 'absolute', bottom: 16, left: 16, right: 16, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  heroTitle: { color: '#fff', fontSize: 28, fontWeight: '400', letterSpacing: -0.015 },
  heroPlay: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  artistCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.card, borderWidth: 1 },
  artistSlot: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginBottom: 3 },
  artistName: { fontSize: 20, fontWeight: '400', letterSpacing: -0.01 },
  pair: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 32 },
  pairSlot: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginTop: 8, marginBottom: 2 },
  pairTitle: { fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
});
