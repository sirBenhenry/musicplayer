import React, { useCallback, useState } from 'react';
import {
  ScrollView, View, Text, Pressable, StyleSheet, Dimensions, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { CoverArt } from '../../components/shared/CoverArt';
import { Icon } from '../../components/shared/Icon';
import { ProfilePickerModal } from '../../components/shared/ProfilePickerModal';
import { TextInputModal } from '../../components/shared/TextInputModal';
import {
  getTodayPlaylists, getArtists, getStreamUrl, getCoverUrl,
  notificationAction, getNotifications, getNotificationCount,
} from '../../lib/api';
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

function periodWord() {
  const h = new Date().getHours();
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

function playlistCoverUrl(pl: any): string | null {
  const song = pl?.songs?.find?.((s: any) => s.navidrome_id);
  return song ? getCoverUrl(song.navidrome_id) : null;
}

function profileHue(hue: number): string {
  return `hsl(${hue}, 35%, 60%)`;
}

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    activeProfileId, profiles, setProfileMenuOpen,
    notificationCount, setNotificationCount,
  } = useStore();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newReleaseArtist, setNewReleaseArtist] = useState<any>(null);
  const [actionNotifs, setActionNotifs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Genre-prompt accept flow: pick existing profile or name a new one
  const [genrePromptNotif, setGenrePromptNotif] = useState<any>(null);
  const [genreNameModal, setGenreNameModal] = useState<any>(null);

  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const load = useCallback(async () => {
    if (!activeProfileId) return;
    await Promise.all([
      getTodayPlaylists(activeProfileId).then(setPlaylists).catch(() => {}),
      getArtists({ followed: 'true' }).then((artists: any[]) => {
        const nr = artists.find((a) => a.new_release_flagged_at || a.new_release);
        setNewReleaseArtist(nr ?? null);
      }).catch(() => {}),
      getNotifications().then((notifs: any[]) => {
        setActionNotifs(notifs.filter((n) => n.type === 'genre_prompt' || n.type === 'artist_prompt'));
      }).catch(() => {}),
      getNotificationCount().then((d) => setNotificationCount(d.count)).catch(() => {}),
    ]);
  }, [activeProfileId, setNotificationCount]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleNotifAction = useCallback((notif: any, accept: boolean, profileId?: string, newName?: string) => {
    notificationAction(notif.id, accept, profileId, newName)
      .then(() => {
        setActionNotifs((prev) => prev.filter((n) => n.id !== notif.id));
        setNotificationCount(Math.max(0, useStore.getState().notificationCount - 1));
      })
      .catch(() => {});
  }, [setNotificationCount]);

  const close = playlists.find((p) => p.slot === 'close');
  const artist = playlists.find((p) => p.slot === 'artist');
  const broader = playlists.find((p) => p.slot === 'broader');
  const genre = playlists.find((p) => p.slot === 'genre');

  const playFirst = (pl: any) => {
    const playable = (pl?.songs ?? []).filter((s: any) => s.navidrome_id);
    const track = playable[0];
    if (!track) return;
    const ctx = playable.map((s: any) => ({ ...s, artist: s.artist ?? '', duration_sec: s.duration_sec ?? 0 }));
    playSong(ctx[0], getStreamUrl(track.navidrome_id), pl.id, ctx);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 160 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          tintColor={theme.accent}
        />
      }
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={[styles.greetLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
          {greeting().toUpperCase()}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable
            onPress={() => router.push('/notifications')}
            hitSlop={8}
            style={({ pressed }) => [styles.bellBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="notification" color={theme.fgMuted} size={19} />
            {notificationCount > 0 && (
              <View style={[styles.bellBadge, { backgroundColor: theme.accent, borderColor: theme.bg }]}>
                <Text style={{ color: theme.onAccent, fontSize: 9, fontWeight: '700' }}>
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Text>
              </View>
            )}
          </Pressable>
          {profile ? (
            <Pressable
              style={({ pressed }) => [styles.profileChip, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => setProfileMenuOpen(true)}
            >
              <View style={[styles.profileDot, { backgroundColor: profileHue(profile.hue) }]}>
                <Text style={styles.profileGlyph}>{profile.glyph}</Text>
              </View>
              <Text style={[styles.profileName, { color: theme.fgStrong }]}>{profile.name}</Text>
              <Icon name="chevronDown" color={theme.fgMuted} size={14} />
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/settings')} style={{ padding: 6 }}>
              <Icon name="settings" color={theme.fgMuted} size={20} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.titleWrap}>
        <Text style={[styles.title, { color: theme.fgStrong, fontFamily: font.display }]}>
          {weekday}{' '}
          <Text style={{ color: theme.fgMuted }}>{periodWord()}</Text>
        </Text>
      </View>

      {/* New release banner */}
      {newReleaseArtist && (
        <View style={{ paddingHorizontal: 20, marginBottom: 22 }}>
          <Pressable
            onPress={() => router.push(`/artist/${newReleaseArtist.id}`)}
            style={({ pressed }) => [
              styles.releaseBanner,
              { backgroundColor: theme.bgElev, borderColor: theme.borderSoft, opacity: pressed ? 0.85 : 1 },
            ]}
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
            <Icon name="chevronRight" color={theme.fgMuted} size={16} />
          </Pressable>
        </View>
      )}

      {/* Action prompts — genre_prompt / artist_prompt */}
      {actionNotifs.length > 0 && (
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          {actionNotifs.map((notif) => (
            <View
              key={notif.id}
              style={[styles.promptCard, { backgroundColor: theme.bgElev, borderColor: theme.borderSoft }]}
            >
              <Text style={[styles.promptTitle, { color: theme.fgStrong }]}>
                {notif.type === 'genre_prompt'
                  ? `New genre: ${notif.data?.genre_name ?? 'Discovery'}`
                  : notif.type === 'artist_prompt'
                  ? `${notif.data?.action === 'follow' ? 'Follow' : 'Add'} ${notif.data?.artist_name ?? 'Artist'}?`
                  : notif.message}
              </Text>
              <Text style={[styles.promptBody, { color: theme.fgMuted }]} numberOfLines={2}>
                {notif.message}
              </Text>
              <View style={styles.promptActions}>
                <Pressable
                  onPress={() => {
                    if (notif.type === 'genre_prompt') {
                      setGenrePromptNotif(notif);
                    } else {
                      handleNotifAction(notif, true);
                    }
                  }}
                  style={({ pressed }) => [styles.promptBtn, { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={[styles.promptBtnText, { color: theme.onAccent }]}>
                    {notif.type === 'genre_prompt' ? 'Keep songs…' : 'Accept'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => handleNotifAction(notif, false)}
                  style={({ pressed }) => [styles.promptBtn, { backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={[styles.promptBtnText, { color: theme.fgMuted }]}>Discard</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>TODAY</Text>

      {playlists.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: theme.fgMuted }]}>
            {!activeProfileId ? 'No profile set up yet' : 'No playlists generated yet'}
          </Text>
          <Text style={[styles.emptyBody, { color: theme.fgSoft }]}>
            {!activeProfileId
              ? 'Add music via Search, then profiles will appear here.'
              : 'Add artists via Search or wait for the nightly generation.'}
          </Text>
        </View>
      )}

      {/* Hero — Close Match */}
      {close && (
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          <Pressable
            onPress={() => router.push(`/playlist/${close.id}`)}
            style={({ pressed }) => [
              styles.heroCard,
              { backgroundColor: theme.surface, borderColor: theme.borderSoft, opacity: pressed ? 0.92 : 1 },
            ]}
          >
            <View style={styles.heroImgWrap}>
              <CoverArt
                uri={playlistCoverUrl(close)}
                size={SW - 40}
                title="Close Match"
                borderRadius={0}
                style={{ width: '100%', height: 188 }}
              />
              {/* gradient overlay — bottom half only */}
              <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]} pointerEvents="none">
                <View style={{ height: '60%', backgroundColor: 'rgba(0,0,0,0.5)' }} />
              </View>
              <View style={styles.heroLabel}>
                <Text style={[styles.heroSlot, { fontFamily: font.mono }]}>CLOSE MATCH</Text>
              </View>
              <View style={styles.heroBottom}>
                <Text style={[styles.heroTitle, { fontFamily: font.display }]}>
                  {"Today's picks"}
                </Text>
                <Pressable
                  onPress={() => playFirst(close)}
                  style={({ pressed }) => [styles.heroPlay, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
                  hitSlop={8}
                >
                  <Icon name="play" color="#1f1a14" size={20} />
                </Pressable>
              </View>
            </View>
          </Pressable>
        </View>
      )}

      {/* Artist of the Day */}
      {artist && (
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          <Pressable
            onPress={() => router.push(`/playlist/${artist.id}`)}
            style={({ pressed }) => [
              styles.artistCard,
              { backgroundColor: theme.surface, borderColor: theme.borderSoft, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <CoverArt
              uri={playlistCoverUrl(artist)}
              size={64}
              title="Artist"
              borderRadius={32}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.artistSlot, { color: theme.fgMuted, fontFamily: font.mono }]}>
                ARTIST OF THE DAY
              </Text>
              <Text style={[styles.artistName, { color: theme.fgStrong, fontFamily: font.display }]} numberOfLines={1}>
                {artist.songs?.find((s: any) => s._artist_of_day)?._artist_of_day ?? 'New artist'}
              </Text>
            </View>
            <Icon name="chevronRight" color={theme.fgMuted} size={18} />
          </Pressable>
        </View>
      )}

      {/* Broader + Genre pair */}
      <View style={styles.pair}>
        {[broader, genre].map((pl) =>
          pl ? (
            <Pressable
              key={pl.id}
              onPress={() => router.push(`/playlist/${pl.id}`)}
              style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
            >
              <CoverArt
                uri={playlistCoverUrl(pl)}
                size={(SW - 52) / 2}
                title={pl.slot}
                style={{ width: '100%', aspectRatio: 1 }}
              />
              <Text style={[styles.pairSlot, { color: theme.fgMuted, fontFamily: font.mono }]}>
                {pl.slot === 'broader' ? 'BROADER' : 'NEW GENRE'}
              </Text>
              <Text style={[styles.pairTitle, { color: theme.fgStrong }]} numberOfLines={1}>
                {pl.slot === 'broader'
                  ? 'Broader taste'
                  : pl.songs?.find((s: any) => s._genre)?._genre ?? 'New genre'}
              </Text>
            </Pressable>
          ) : null,
        )}
      </View>

      {/* Genre prompt: pick target profile (or create new) */}
      <ProfilePickerModal
        visible={genrePromptNotif !== null}
        songTitle={genrePromptNotif ? `${genrePromptNotif.data?.song_ids?.length ?? ''} songs from "${genrePromptNotif.data?.genre_name ?? 'genre'}"` : ''}
        noneLabel="Create new profile…"
        onClose={() => setGenrePromptNotif(null)}
        onPick={(profileId) => {
          const notif = genrePromptNotif;
          setGenrePromptNotif(null);
          if (!notif) return;
          if (profileId) {
            handleNotifAction(notif, true, profileId);
          } else {
            // "All Music only" → treat as new-profile path with a name prompt
            setGenreNameModal(notif);
          }
        }}
      />
      <TextInputModal
        visible={genreNameModal !== null}
        title="New taste profile"
        placeholder="Profile name…"
        defaultValue={genreNameModal?.data?.genre_name ?? ''}
        confirmLabel="Create & keep songs"
        onCancel={() => setGenreNameModal(null)}
        onConfirm={(name) => {
          const notif = genreNameModal;
          setGenreNameModal(null);
          if (!notif) return;
          handleNotifAction(notif, true, 'new', name || notif.data?.genre_name);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  greetLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginTop: 8 },
  bellBtn: { padding: 6, marginTop: -2 },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 11,
    borderRadius: 100,
    marginTop: -4,
  },
  profileDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileGlyph: { fontSize: 13, color: '#fffdf8' },
  profileName: { fontSize: 12.5, fontWeight: '500' },
  titleWrap: { paddingHorizontal: 20, paddingBottom: 22 },
  title: { fontSize: 30, lineHeight: 34, letterSpacing: -0.015 },
  releaseBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    paddingRight: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  releaseLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  releaseLabelText: { fontSize: 9.5, letterSpacing: 0.12, fontWeight: '500' },
  releaseArtist: { fontSize: 13.5, fontWeight: '500' },
  sectionLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', paddingHorizontal: 20, marginBottom: 14 },
  promptCard: {
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10,
  },
  promptTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  promptBody: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  promptActions: { flexDirection: 'row', gap: 8 },
  promptBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  promptBtnText: { fontSize: 13, fontWeight: '600' },
  heroCard: { borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  heroImgWrap: { height: 188, position: 'relative' },
  heroLabel: { position: 'absolute', top: 16, left: 16 },
  heroSlot: { fontSize: 10.5, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.12, fontWeight: '500' },
  heroBottom: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },
  heroTitle: { color: '#fff', fontSize: 28, lineHeight: 32, letterSpacing: -0.015, flex: 1 },
  heroPlay: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
    flexShrink: 0,
  },
  artistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  artistSlot: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginBottom: 3 },
  artistName: { fontSize: 20, lineHeight: 24, letterSpacing: -0.01 },
  pair: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 32 },
  pairSlot: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginTop: 8, marginBottom: 2 },
  pairTitle: { fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
  emptyState: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  emptyTitle: { fontSize: 15, fontWeight: '500', marginBottom: 6 },
  emptyBody: { fontSize: 13.5, lineHeight: 20 },
});
