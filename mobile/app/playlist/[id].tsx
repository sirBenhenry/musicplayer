import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../lib/store';
import { useTheme } from '../../hooks/useTheme';
import { Icon } from '../../components/shared/Icon';
import { CoverArt } from '../../components/shared/CoverArt';
import { getPlaylist, pausePlaylist, flagSong, getStreamUrl, getCoverUrl, searchNewArtists, importArtist } from '../../lib/api';
import { playSong, addToQueue } from '../../lib/audio';
import { font, radius } from '../../lib/tokens';

const SLOT_LABELS: Record<string, string> = {
  close: 'Close Match',
  broader: 'Broader Taste',
  genre: 'New Genre',
  artist: 'Artist of the Day',
};

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function totalDuration(songs: any[]): string {
  const total = songs.reduce((acc, s) => acc + (s.duration_sec ?? 0), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function PlaylistScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<any>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [artistAdding, setArtistAdding] = useState(false);
  const [artistAdded, setArtistAdded] = useState(false);
  const { profiles, activeProfileId } = useStore();

  useEffect(() => {
    if (!id) return;
    getPlaylist(id).then((pl) => {
      setPlaylist(pl);
      setPaused(pl.paused_to_tomorrow);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const handlePause = async () => {
    if (!id) return;
    await pausePlaylist(id);
    setPaused(true);
  };

  const songs: any[] = (playlist?.songs ?? []).filter(
    (s: any) => !s._genre && !s._artist_of_day,
  );
  const playableSongs = songs.filter((s: any) => s.navidrome_id);
  const slot = playlist?.slot ?? '';
  const slotLabel = SLOT_LABELS[slot] ?? 'Playlist';
  const artistName: string | null = slot === 'artist'
    ? (playlist?.songs?.find((s: any) => s._artist_of_day)?._artist_of_day ?? null)
    : null;
  const titleText = slot === 'genre'
    ? (playlist?.songs?.find((s: any) => s._genre)?._genre ?? 'New Genre')
    : artistName ?? slotLabel;

  const coverSong = songs.find((s: any) => s.navidrome_id);
  const coverUri = coverSong ? getCoverUrl(coverSong.navidrome_id) : null;

  const profile = profiles.find((p) => p.id === (playlist?.profile_id ?? activeProfileId));

  const addArtist = async () => {
    if (!artistName || artistAdding || artistAdded) return;
    setArtistAdding(true);
    try {
      const results = await searchNewArtists(artistName);
      const match = results?.[0];
      if (!match?.mbid) throw new Error('Artist not found');
      await importArtist({ mbid: match.mbid, name: match.name ?? artistName, follow: false });
      setArtistAdded(true);
    } catch {
      Alert.alert('Could not add artist', 'Try searching manually in the Search tab.');
    } finally {
      setArtistAdding(false);
    }
  };

  const playAll = () => {
    if (!playableSongs.length) return;
    const first = playableSongs[0];
    useStore.getState().setQueue(
      playableSongs.map((s) => ({ ...s, artist: s.artist ?? '', duration_sec: s.duration_sec ?? 0 })),
      0,
    );
    playSong({ ...first, artist: first.artist ?? '', duration_sec: first.duration_sec ?? 0 },
      getStreamUrl(first.navidrome_id), id);
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <CoverArt
            uri={coverUri}
            size={208}
            title={titleText}
            borderRadius={radius.card}
            style={{ shadowColor: '#281910', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 32, elevation: 8 }}
          />
          <Text style={[styles.accent, { color: theme.fgMuted, fontFamily: font.mono }]}>
            {`Daily · ${slotLabel}`}
          </Text>
          <Text style={[styles.title, { color: theme.fgStrong, fontFamily: font.display }]}>
            {titleText}
          </Text>
          <Text style={[styles.meta, { color: theme.fgSoft, fontFamily: font.mono }]}>
            {`${songs.length} songs · ${totalDuration(playableSongs)} · ${profile?.name ?? ''}`}
          </Text>
        </View>

        {/* Action row */}
        <View style={styles.actions}>
          <Pressable
            onPress={playAll}
            style={({ pressed }) => [styles.btnPrimary, { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1, flex: 1 }]}
          >
            <Icon name="play" color="#fff" size={18} />
            <Text style={[styles.btnPrimaryText, { color: '#fff' }]}>Play</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.btnGhost, { borderColor: theme.borderSoft, opacity: pressed ? 0.7 : 1 }]}
          >
            <Icon name="shuffle" color={theme.fgMuted} size={18} />
          </Pressable>
        </View>

        {/* Add Artist button — only for Artist of the Day */}
        {artistName && (
          <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
            <Pressable
              onPress={addArtist}
              disabled={artistAdding || artistAdded}
              style={({ pressed }) => [
                styles.addArtistBtn,
                {
                  backgroundColor: artistAdded ? theme.accentBg : theme.bgElev,
                  borderColor: artistAdded ? `${theme.accent}4d` : theme.borderSoft,
                  opacity: pressed && !artistAdded ? 0.75 : 1,
                },
              ]}
            >
              {artistAdding ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Icon name={artistAdded ? 'check' : 'plus'} color={artistAdded ? theme.accent : theme.fgStrong} size={16} />
              )}
              <Text style={[styles.addArtistText, { color: artistAdded ? theme.accent : theme.fgStrong }]}>
                {artistAdded ? `${artistName} added` : `Add ${artistName} to library`}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Behavior hints */}
        <View style={[styles.hints, { backgroundColor: theme.bgElev, borderColor: theme.borderSoft }]}>
          <View style={styles.hintRow}>
            <Icon name="check" color={theme.fgMuted} size={16} strokeWidth={2} />
            <Text style={[styles.hintText, { color: theme.fgMuted }]}>
              <Text style={{ color: theme.fgStrong, fontWeight: '600' }}>Listen through</Text>
              {' '}a song to save it to your library.
            </Text>
          </View>
          <View style={[styles.hintDivider, { backgroundColor: theme.borderSoft }]} />
          <View style={styles.hintRow}>
            <Icon name="skip" color={theme.fgMuted} size={16} strokeWidth={2} />
            <Text style={[styles.hintText, { color: theme.fgMuted }]}>
              <Text style={{ color: theme.fgStrong, fontWeight: '600' }}>Skip</Text>
              {' '}to mark for deletion at end of day.
            </Text>
          </View>
        </View>

        {/* Songs */}
        {songs.map((song, i) => {
          const playable = !!song.navidrome_id;
          const songFlag: 'kept' | 'delete' | undefined =
            song.flag === 'keep' ? 'kept' : song.flag === 'delete' ? 'delete' : undefined;
          return (
            <Pressable
              key={song.id ?? `${song.artist}-${song.title}-${i}`}
              onPress={() => {
                if (!playable) return;
                useStore.getState().setQueue(
                  playableSongs.map((s) => ({ ...s, artist: s.artist ?? '', duration_sec: s.duration_sec ?? 0 })),
                  playableSongs.indexOf(song),
                );
                playSong({ ...song, artist: song.artist ?? '', duration_sec: song.duration_sec ?? 0 },
                  getStreamUrl(song.navidrome_id), id);
              }}
              onLongPress={() => {
                if (!song.id || !id) return;
                const currentAction = song.flag === 'keep' ? 'delete' : 'keep';
                const label = currentAction === 'keep' ? 'Mark as Keep ✓' : 'Mark as Delete ✗';
                Alert.alert('Flag song', undefined, [
                  {
                    text: label,
                    onPress: () => {
                      flagSong(id, song.id, currentAction).then(() => {
                        // Update local state optimistically
                        setPlaylist((prev: any) => prev ? {
                          ...prev,
                          songs: prev.songs.map((s: any) =>
                            s.id === song.id ? { ...s, flag: currentAction } : s
                          ),
                        } : prev);
                      }).catch(() => {});
                    },
                  },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }}
              style={({ pressed }) => [styles.songRow, { opacity: pressed && playable ? 0.7 : 1 }]}
            >
              <Text style={[styles.songIdx, { color: theme.fgSoft, fontFamily: font.mono }]}>
                {(i + 1).toString().padStart(2, '0')}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.songTitle, { color: playable ? theme.fgStrong : theme.fgMuted }]} numberOfLines={1}>
                  {song.title}
                </Text>
                <Text style={[styles.songArtist, { color: theme.fgSoft }]} numberOfLines={1}>
                  {song.artist}
                </Text>
              </View>
              {songFlag === 'kept' && (
                <View style={[styles.flagBadge, { backgroundColor: '#22c55e' }]}>
                  <Icon name="check" color="#fff" size={12} strokeWidth={2.5} />
                </View>
              )}
              {songFlag === 'delete' && (
                <View style={[styles.flagBadge, { backgroundColor: '#ef4444' }]}>
                  <Icon name="close" color="#fff" size={12} strokeWidth={2.5} />
                </View>
              )}
              {!songFlag && !playable && (
                <Text style={[styles.songDuration, { color: theme.fgSoft, fontFamily: font.mono }]}>↓</Text>
              )}
              {!songFlag && playable && song.duration_sec ? (
                <Text style={[styles.songDuration, { color: theme.fgSoft, fontFamily: font.mono }]}>
                  {fmtDuration(song.duration_sec)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}

        {songs.length === 0 && (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
              Tracks will appear here once discovery runs.
            </Text>
          </View>
        )}

        {/* Pause to tomorrow */}
        <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
          <Pressable
            onPress={!paused ? handlePause : undefined}
            style={({ pressed }) => [
              styles.pauseBtn,
              {
                backgroundColor: paused ? theme.accentBg : theme.bgElev,
                borderColor: paused ? `${theme.accent}4d` : theme.borderSoft,
                opacity: pressed && !paused ? 0.8 : 1,
              },
            ]}
          >
            <Icon name="history" color={paused ? theme.accent : theme.fgStrong} size={20} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.pauseTitle, { color: paused ? theme.accent : theme.fgStrong }]}>
                {paused ? 'Paused — saved for tomorrow' : 'Pause to tomorrow'}
              </Text>
              <Text style={[styles.pauseBody, { color: paused ? theme.accent : theme.fgMuted, opacity: paused ? 0.75 : 1 }]}>
                {paused ? "Won't be replaced until you listen." : "Don't have time? Keep it for tomorrow."}
              </Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    paddingHorizontal: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, alignItems: 'center', gap: 0 },
  accent: { fontSize: 11, letterSpacing: 0.08, fontWeight: '500', marginTop: 18, marginBottom: 8, textTransform: 'uppercase' },
  title: { fontSize: 32, lineHeight: 36, letterSpacing: -0.015, color: '#1a1a1a', textAlign: 'center' },
  meta: { fontSize: 11.5, letterSpacing: 0.08, textTransform: 'uppercase', marginTop: 14 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingBottom: 18, alignItems: 'center' },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 44, borderRadius: radius.pill,
  },
  btnPrimaryText: { fontSize: 15, fontWeight: '600' },
  btnGhost: {
    width: 48, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1,
  },
  hints: {
    marginHorizontal: 20, marginBottom: 16, borderRadius: radius.card,
    borderWidth: 1, padding: 12, gap: 10,
  },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  hintText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  hintDivider: { height: 1 },
  songRow: {
    flexDirection: 'row', alignItems: 'center', gap: 0,
    paddingHorizontal: 20, paddingVertical: 11,
  },
  songIdx: { width: 28, textAlign: 'center', fontSize: 12 },
  songTitle: { fontSize: 14.5, fontWeight: '500', marginBottom: 2 },
  songArtist: { fontSize: 12.5 },
  songDuration: { fontSize: 11.5, marginLeft: 8 },
  flagBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  pauseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, paddingHorizontal: 16, borderRadius: radius.card, borderWidth: 1,
  },
  addArtistBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 13, paddingHorizontal: 16, borderRadius: radius.card, borderWidth: 1,
  },
  addArtistText: { fontSize: 14, fontWeight: '500' },
  pauseTitle: { fontSize: 14, fontWeight: '600' },
  pauseBody: { fontSize: 12, marginTop: 1 },
});
