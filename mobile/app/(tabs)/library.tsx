import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useStore } from '../../lib/store';
import { SongRow } from '../../components/shared/SongRow';
import { CoverArt } from '../../components/shared/CoverArt';
import { Icon } from '../../components/shared/Icon';
import { PlaylistPickerModal } from '../../components/shared/PlaylistPickerModal';
import { SongActionSheet } from '../../components/shared/SongActionSheet';
import { ProfilePickerModal } from '../../components/shared/ProfilePickerModal';
import { TextInputModal } from '../../components/shared/TextInputModal';
import {
  getSongs, getArtists, getPlaylists, getUserPlaylists, createUserPlaylist,
  deleteUserPlaylist, getStreamUrl, getCoverUrl, importSpotifyPlaylist,
  getLibraryStamp,
} from '../../lib/api';
import { playSong, addToQueue } from '../../lib/audio';
import { libraryCache } from '../../lib/libraryCache';
import { appendLog, flushNow } from '../../lib/logger';
import { font, radius } from '../../lib/tokens';

type Tab = 'Songs' | 'Artists' | 'Playlists';

const SLOT_LABEL: Record<string, string> = {
  close: 'Close Match',
  broader: 'Broader Taste',
  genre: 'New Genre',
  artist: 'Artist of the Day',
};

export default function LibraryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfileId, profiles } = useStore();

  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? null;
  const isCatchall = activeProfile?.is_catchall ?? true;

  const [tab, setTab] = useState<Tab>('Songs');
  const [searchQuery, setSearchQuery] = useState('');

  // Single source of truth for library data — all songs + all artists
  const [allSongs, setAllSongs] = useState<any[]>([]);
  const [allArtists, setAllArtists] = useState<any[]>([]);
  const [dailyPlaylists, setDailyPlaylists] = useState<any[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);

  // Profile filter toggle (user can override)
  const [filterProfile, setFilterProfile] = useState(!isCatchall);

  // True once we have at least some data (cache or fresh) so we never show a blank flash
  const [ready, setReady] = useState(false);

  const [actionSong, setActionSong] = useState<{ id: string; title: string; profile_id?: string | null } | null>(null);
  const [pickerSong, setPickerSong] = useState<{ id: string; title: string } | null>(null);
  const [profilePickerSong, setProfilePickerSong] = useState<{ id: string; title: string; profile_id?: string | null } | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [spotifyImportVisible, setSpotifyImportVisible] = useState(false);
  const [spotifyImporting, setSpotifyImporting] = useState(false);
  const [pendingSpotifyUrl, setPendingSpotifyUrl] = useState<string | null>(null);

  // ── Derived state ─────────────────────────────────────────────────────────

  const sq = searchQuery.toLowerCase();

  // Pre-map songs once when raw data changes (stable refs for SongRow React.memo)
  const displaySongs = useMemo(() => {
    const base = filterProfile && activeProfileId && !isCatchall
      ? allSongs.filter(s => s.profile_id === activeProfileId)
      : allSongs;
    return base.map(s => ({
      ...s,
      artist: s.artist_name ?? '',
      duration_sec: s.duration_sec ?? 0,
      cover_url: getCoverUrl(s.navidrome_id),
    }));
  }, [allSongs, filterProfile, activeProfileId, isCatchall]);

  const filteredSongs = useMemo(
    () => sq
      ? displaySongs.filter(s =>
          s.title?.toLowerCase().includes(sq) ||
          (s.artist_name ?? '').toLowerCase().includes(sq))
      : displaySongs,
    [displaySongs, sq],
  );

  // Stable ref so onPress closure always has current list
  const filteredSongsRef = useRef(filteredSongs);
  useEffect(() => { filteredSongsRef.current = filteredSongs; }, [filteredSongs]);

  // Derive followed artists + profile artists from allArtists + allSongs
  // Artist names with songs in this profile (used to scope followed artists per-profile)
  const profileArtistNames = useMemo(() => {
    if (!filterProfile || !activeProfileId || isCatchall) return null; // null = no filter
    return new Set(
      allSongs
        .filter(s => s.profile_id === activeProfileId)
        .map(s => (s.display_artist || s.artist_name || '').toLowerCase())
        .filter(Boolean),
    );
  }, [allSongs, filterProfile, activeProfileId, isCatchall]);

  // Section 1: Following = followed + monitored (lidarr_id set)
  // When profile filter active, only show artists who have songs in this profile
  const followingArtists = useMemo(
    () => allArtists.filter(a =>
      a.followed && a.monitored &&
      (profileArtistNames === null || profileArtistNames.has((a.name || '').toLowerCase()))
    ),
    [allArtists, profileArtistNames],
  );

  // Section 2: Added = followed but not monitored
  const addedArtists = useMemo(
    () => allArtists.filter(a =>
      a.followed && !a.monitored &&
      (profileArtistNames === null || profileArtistNames.has((a.name || '').toLowerCase()))
    ),
    [allArtists, profileArtistNames],
  );

  // Section 3: Implicit = not explicitly followed, but have songs in the active profile
  // Songs don't expose artist_id in the API — match by artist_name/display_artist instead
  const implicitArtists = useMemo(() => {
    if (!filterProfile || !activeProfileId || isCatchall) return [];
    const profileSongArtistNames = new Set(
      allSongs
        .filter(s => s.profile_id === activeProfileId)
        .map(s => (s.display_artist || s.artist_name || '').toLowerCase())
        .filter(Boolean),
    );
    const followedIds = new Set(allArtists.filter(a => a.followed).map(a => String(a.id)));
    return allArtists.filter(
      a => profileSongArtistNames.has((a.name || '').toLowerCase()) && !followedIds.has(String(a.id)),
    );
  }, [allSongs, allArtists, filterProfile, activeProfileId, isCatchall]);

  const filteredFollowing = sq
    ? followingArtists.filter(a => a.name?.toLowerCase().includes(sq))
    : followingArtists;
  const filteredAdded = sq
    ? addedArtists.filter(a => a.name?.toLowerCase().includes(sq))
    : addedArtists;
  const filteredImplicit = sq
    ? implicitArtists.filter(a => a.name?.toLowerCase().includes(sq))
    : implicitArtists;

  const artistItems: any[] = [];
  if (!isCatchall) {
    if (filteredFollowing.length > 0) {
      artistItems.push({ _type: 'artist_sec', label: 'Following' });
      for (const a of filteredFollowing) artistItems.push({ _type: 'artist_row', ...a });
    }
    if (filteredAdded.length > 0) {
      artistItems.push({ _type: 'artist_sec', label: 'Added' });
      for (const a of filteredAdded) artistItems.push({ _type: 'artist_row', ...a });
    }
    if (filteredImplicit.length > 0) {
      artistItems.push({ _type: 'artist_sec', label: activeProfile?.name ?? 'This Profile' });
      for (const a of filteredImplicit) artistItems.push({ _type: 'artist_row', ...a });
    }
    if (artistItems.length === 0) {
      artistItems.push({ _type: 'artist_empty', message: sq ? 'No matching artists' : 'No artists in this profile yet.' });
    }
  } else {
    // Catchall: flat list of all artists
    const allFiltered = sq ? allArtists.filter(a => a.name?.toLowerCase().includes(sq)) : allArtists;
    if (allFiltered.length === 0) {
      artistItems.push({ _type: 'artist_empty', message: sq ? 'No matching artists' : 'No artists yet.' });
    } else {
      for (const a of allFiltered) artistItems.push({ _type: 'artist_row', ...a });
    }
  }

  const filteredUserPlaylists = sq
    ? userPlaylists.filter(p => p.name?.toLowerCase().includes(sq))
    : userPlaylists;
  const filteredDailyPlaylists = sq
    ? dailyPlaylists.filter(p => p.slot?.toLowerCase().includes(sq) || p.date?.includes(sq))
    : dailyPlaylists;

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadUserPlaylists = () =>
    getUserPlaylists().then(setUserPlaylists).catch(() => {});

  // Load cache immediately, then check stamp and refresh in background
  useEffect(() => {
    let alive = true;

    async function init() {
      try {
        appendLog('[Library] init start');
        const [cs, ca] = await Promise.all([
          libraryCache.loadSongs(),
          libraryCache.loadArtists(),
        ]);
        appendLog(`[Library] cache loaded: ${cs.length} songs, ${ca.length} artists`);
        if (!alive) return;
        if (cs.length) setAllSongs(cs);
        if (ca.length) setAllArtists(ca);
        if (cs.length || ca.length) setReady(true);

        await refreshIfStale(alive);
        if (alive) setReady(true);
        appendLog('[Library] init complete');
      } catch (e: any) {
        appendLog(`[Library] init ERROR: ${e?.message}\n${e?.stack ?? ''}`);
        flushNow();
      }
    }

    init();
    return () => { alive = false; };
  }, []);

  // Background stamp poll every 15s
  useEffect(() => {
    const id = setInterval(() => refreshIfStale(), 15000);
    return () => clearInterval(id);
  }, []);

  // Profile switch: reset filter, reload playlists (songs now client-side)
  useEffect(() => {
    setFilterProfile(!isCatchall);
    getPlaylists(activeProfileId ?? undefined).then(setDailyPlaylists).catch(() => {});
    loadUserPlaylists();
  }, [activeProfileId]);

  // Refresh artists + playlists on focus (follow/unfollow, new daily playlists, renames)
  useFocusEffect(useCallback(() => {
    getArtists().then(all => {
      setAllArtists(all);
      libraryCache.saveArtists(all);
    }).catch(() => {});
    getPlaylists(activeProfileId ?? undefined).then(setDailyPlaylists).catch(() => {});
    loadUserPlaylists();
  }, [activeProfileId]));

  async function refreshIfStale(alive = true) {
    try {
      const [serverStamp, cachedStamp] = await Promise.all([
        getLibraryStamp().catch(() => null),
        libraryCache.getStamp(),
      ]);
      // Stamp unreachable (offline / server down) → can't tell, do nothing this
      // tick instead of hammering the full-library endpoint every 15 s.
      if (!serverStamp) return;
      const stale = serverStamp.updated_at !== cachedStamp;
      if (!stale) return;

      const [freshSongs, freshArtists] = await Promise.all([
        getSongs({ limit: '5000' }),
        getArtists(),
      ]);
      if (!alive) return;

      setAllSongs(freshSongs);
      setAllArtists(freshArtists);
      await Promise.all([
        libraryCache.saveSongs(freshSongs),
        libraryCache.saveArtists(freshArtists),
        serverStamp ? libraryCache.saveStamp(serverStamp.updated_at) : Promise.resolve(),
      ]);
    } catch {}
  }

  // Force immediate refresh (after local mutations)
  async function forceRefresh() {
    try {
      const [freshSongs, freshArtists, serverStamp] = await Promise.all([
        getSongs({ limit: '5000' }),
        getArtists(),
        getLibraryStamp().catch(() => null),
      ]);
      setAllSongs(freshSongs);
      setAllArtists(freshArtists);
      await Promise.all([
        libraryCache.saveSongs(freshSongs),
        libraryCache.saveArtists(freshArtists),
        serverStamp ? libraryCache.saveStamp(serverStamp.updated_at) : Promise.resolve(),
      ]);
    } catch {}
  }

  const handleDeleteUserPlaylist = (id: string, name: string) => {
    Alert.alert('Delete playlist', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try { await deleteUserPlaylist(id); loadUserPlaylists(); } catch {}
        },
      },
    ]);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const TABS: Tab[] = ['Songs', 'Artists', 'Playlists'];

  type ListItem =
    | { _type: 'header'; label: string; showAdd?: boolean; showImport?: boolean }
    | { _type: 'user_playlist'; id: string; name: string; song_count: number }
    | { _type: 'daily_playlist'; id: string; slot: string; date: string; song_count: number; paused_to_tomorrow: boolean }
    | { _type: 'empty'; message: string };

  const playlistItems: ListItem[] = [];
  playlistItems.push({ _type: 'header', label: 'My Playlists', showAdd: true, showImport: true });
  if (filteredUserPlaylists.length === 0) {
    playlistItems.push({ _type: 'empty', message: sq ? 'No matching playlists' : 'No playlists yet. Tap + New to create one.' });
  } else {
    for (const p of filteredUserPlaylists) {
      playlistItems.push({ _type: 'user_playlist', id: p.id, name: p.name, song_count: p.song_count });
    }
  }
  playlistItems.push({ _type: 'header', label: 'Daily' });
  if (filteredDailyPlaylists.length === 0) {
    playlistItems.push({ _type: 'empty', message: sq ? 'No matching playlists' : 'Generated daily by the discovery pipeline.' });
  } else {
    for (const p of filteredDailyPlaylists) {
      playlistItems.push({
        _type: 'daily_playlist',
        id: p.id, slot: p.slot, date: p.date,
        song_count: p.song_count, paused_to_tomorrow: p.paused_to_tomorrow,
      });
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={[styles.headerLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>LIBRARY</Text>
          <Text style={[styles.heading, { color: theme.fgStrong, fontFamily: font.display }]}>
            Your collection
          </Text>
        </View>
        <Pressable
          onPress={() => setCreateModalVisible(true)}
          style={styles.addBtn}
          hitSlop={8}
        >
          <Icon name="plus" color={theme.fgStrong} size={22} />
        </Pressable>
      </View>

      {/* Pill tabs */}
      <View style={styles.tabRow}>
        {TABS.map((t) => {
          const active = tab === t;
          const count = t === 'Songs'
            ? filteredSongs.length
            : t === 'Artists'
              ? filteredFollowing.length + filteredAdded.length + filteredImplicit.length
              : filteredUserPlaylists.length + filteredDailyPlaylists.length;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[
                styles.tabPill,
                {
                  backgroundColor: active ? theme.fgStrong : 'transparent',
                  borderColor: active ? 'transparent' : theme.border,
                },
              ]}
            >
              <Text style={[styles.tabText, { color: active ? theme.bg : theme.fgMuted }]}>
                {t}
              </Text>
              <Text style={[styles.tabCount, { color: active ? theme.bgElev : theme.fgFaint }]}>
                {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Search bar */}
      <View style={[styles.searchWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Icon name="search" color={theme.fgSoft} size={16} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={tab === 'Songs' ? 'Search songs…' : tab === 'Artists' ? 'Search artists…' : 'Search playlists…'}
          placeholderTextColor={theme.fgSoft}
          style={[styles.searchInput, { color: theme.fg }]}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
            <Icon name="close" color={theme.fgSoft} size={16} />
          </Pressable>
        )}
      </View>

      {/* Filter row (songs only) */}
      {tab === 'Songs' && (
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setFilterProfile(!filterProfile)}
            style={[
              styles.filterChip,
              {
                backgroundColor: filterProfile ? theme.accentBg : 'transparent',
                borderColor: filterProfile ? theme.accentTint : theme.border,
              },
            ]}
          >
            <Icon name="filter" color={filterProfile ? theme.accent : theme.fgMuted} size={14} />
            <Text style={[styles.filterText, { color: filterProfile ? theme.accent : theme.fgMuted }]}>
              {filterProfile ? 'This profile' : 'All profiles'}
            </Text>
          </Pressable>
        </View>
      )}

      {tab === 'Songs' && (
        <FlatList
          data={filteredSongs}
          keyExtractor={(s) => s.id}
          renderItem={({ item, index }) => (
            <SongRow
              song={item}
              onPress={() => {
                playSong(item, getStreamUrl(item.navidrome_id), null, filteredSongsRef.current);
              }}
              onLongPress={() => setActionSong({ id: item.id, title: item.title, profile_id: item.profile_id })}
            />
          )}
          contentContainerStyle={{ paddingBottom: 160 }}
          removeClippedSubviews
          maxToRenderPerBatch={12}
          windowSize={8}
          initialNumToRender={15}
        />
      )}

      {tab === 'Artists' && (
        <FlatList
          data={artistItems}
          keyExtractor={(item: any, i) => item._type === 'artist_row' ? item.id : `${item._type}_${i}`}
          renderItem={({ item }: { item: any }) => {
            if (item._type === 'artist_sec') {
              return (
                <View style={[styles.sectionHeader, { borderBottomColor: theme.borderSoft }]}>
                  <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
                    {item.label.toUpperCase()}
                  </Text>
                </View>
              );
            }
            if (item._type === 'artist_empty') {
              return <Text style={[styles.emptyItem, { color: theme.fgMuted }]}>{item.message}</Text>;
            }
            return (
              <Pressable
                onPress={() => router.push(`/artist/${item.id}`)}
                style={({ pressed }) => [
                  styles.artistRow,
                  { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <CoverArt
                  uri={item.navidrome_id && !item.navidrome_id.startsWith('mb:') ? getCoverUrl(item.navidrome_id) : null}
                  size={48} title={item.name} borderRadius={24}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[styles.artistName, { color: theme.fgStrong }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {item.new_release && (
                      <View style={[styles.releaseDot, { backgroundColor: theme.accent }]} />
                    )}
                  </View>
                  <Text style={[styles.artistMeta, { color: theme.fgMuted }]}>
                    {item.followed && item.monitored ? 'Following' : item.followed ? 'Added' : ''}
                  </Text>
                </View>
                <Icon name="chevronRight" color={theme.fgSoft} size={18} />
              </Pressable>
            );
          }}
          contentContainerStyle={{ paddingBottom: 160 }}
        />
      )}

      {tab === 'Playlists' && (
        <FlatList
          data={playlistItems}
          keyExtractor={(item, i) => {
            if (item._type === 'header') return `hdr_${item.label}`;
            if (item._type === 'empty') return `empty_${i}`;
            return item.id;
          }}
          renderItem={({ item }) => {
            if (item._type === 'header') {
              return (
                <View style={[styles.sectionHeader, { borderBottomColor: theme.borderSoft }]}>
                  <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
                    {item.label.toUpperCase()}
                  </Text>
                  {(item.showAdd || item.showImport) && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      {item.showImport && (
                        <Pressable
                          onPress={() => setSpotifyImportVisible(true)}
                          hitSlop={12}
                          disabled={spotifyImporting}
                        >
                          <Text style={[styles.addLabel, { color: theme.fgMuted }]}>
                            {spotifyImporting ? 'Importing…' : 'Spotify'}
                          </Text>
                        </Pressable>
                      )}
                      {item.showAdd && (
                        <Pressable onPress={() => setCreateModalVisible(true)} hitSlop={12}>
                          <Text style={[styles.addLabel, { color: theme.accent }]}>+ New</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            }
            if (item._type === 'empty') {
              return <Text style={[styles.emptyItem, { color: theme.fgMuted }]}>{item.message}</Text>;
            }
            if (item._type === 'user_playlist') {
              return (
                <Pressable
                  onPress={() => router.push(`/userplaylist/${item.id}`)}
                  onLongPress={() => handleDeleteUserPlaylist(item.id, item.name)}
                  style={({ pressed }) => [
                    styles.playlistRow,
                    { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View style={[styles.userBadge, { backgroundColor: theme.bgElev, borderColor: theme.border }]}>
                    <Icon name="list" color={theme.fgMuted} size={20} />
                  </View>
                  <View style={styles.playlistInfo}>
                    <Text style={[styles.playlistName, { color: theme.fgStrong }]}>{item.name}</Text>
                    <Text style={[styles.playlistMeta, { color: theme.fgMuted }]}>{item.song_count} songs</Text>
                  </View>
                  <Icon name="chevronRight" color={theme.fgSoft} size={18} />
                </Pressable>
              );
            }
            return (
              <Pressable
                onPress={() => router.push(`/playlist/${item.id}`)}
                style={({ pressed }) => [
                  styles.playlistRow,
                  { borderBottomColor: theme.borderSoft, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={[styles.slotBadge, { backgroundColor: theme.accentBg }]}>
                  <Text style={[styles.slotText, { color: theme.accent, fontFamily: font.mono }]}>
                    {(SLOT_LABEL[item.slot] ?? item.slot).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.playlistInfo}>
                  <Text style={[styles.playlistDate, { color: theme.fgStrong }]}>{item.date}</Text>
                  <Text style={[styles.playlistMeta, { color: theme.fgMuted }]}>
                    {item.song_count} songs{item.paused_to_tomorrow ? ' · paused' : ''}
                  </Text>
                </View>
                <Icon name="chevronRight" color={theme.fgSoft} size={18} />
              </Pressable>
            );
          }}
          contentContainerStyle={{ paddingBottom: 160 }}
        />
      )}

      <SongActionSheet
        visible={actionSong !== null}
        song={actionSong}
        onClose={() => setActionSong(null)}
        onAddToPlaylist={() => setPickerSong(actionSong)}
        onAssignProfile={() => setProfilePickerSong(actionSong)}
        onDeleted={() => {
          // Optimistic remove
          const id = actionSong?.id;
          setAllSongs(prev => prev.filter(s => s.id !== id));
          setActionSong(null);
          // Sync cache in background
          forceRefresh();
        }}
      />

      <PlaylistPickerModal
        visible={pickerSong !== null}
        songId={pickerSong?.id ?? ''}
        songTitle={pickerSong?.title ?? ''}
        onClose={() => setPickerSong(null)}
        onAdded={(name) => {
          Alert.alert('Added', `Added to "${name}"`);
          loadUserPlaylists();
        }}
      />

      <ProfilePickerModal
        visible={profilePickerSong !== null}
        songId={profilePickerSong?.id ?? ''}
        songTitle={profilePickerSong?.title ?? ''}
        currentProfileId={profilePickerSong?.profile_id}
        onClose={() => setProfilePickerSong(null)}
        onAssigned={(profileName) => {
          if (profileName) Alert.alert('Assigned', `Moved to "${profileName}"`);
          else Alert.alert('Unassigned', 'Song moved to All Music only');
          setProfilePickerSong(null);
          // Refresh so profile_id updates are reflected in client-side filter
          forceRefresh();
        }}
      />

      <TextInputModal
        visible={createModalVisible}
        title="New playlist"
        placeholder="Playlist name…"
        confirmLabel="Create"
        onCancel={() => setCreateModalVisible(false)}
        onConfirm={async (name) => {
          setCreateModalVisible(false);
          try {
            await createUserPlaylist(name);
            loadUserPlaylists();
          } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not create playlist');
          }
        }}
      />

      <TextInputModal
        visible={spotifyImportVisible}
        title="Import Spotify Playlist"
        placeholder="https://open.spotify.com/playlist/…"
        confirmLabel="Import"
        onCancel={() => setSpotifyImportVisible(false)}
        onConfirm={(url) => {
          setSpotifyImportVisible(false);
          if (!url.trim()) return;
          setPendingSpotifyUrl(url.trim());
        }}
      />

      <ProfilePickerModal
        visible={pendingSpotifyUrl !== null}
        songTitle="Spotify Playlist Import"
        onClose={() => setPendingSpotifyUrl(null)}
        onPick={async (profileId) => {
          const url = pendingSpotifyUrl!;
          setPendingSpotifyUrl(null);
          setSpotifyImporting(true);
          try {
            const res = await importSpotifyPlaylist(url, profileId ?? undefined);
            loadUserPlaylists();
            router.push(`/userplaylist/${res.playlist_id}`);
            Alert.alert('Importing', `Queued ${res.track_count} tracks for "${res.name}". They'll appear as downloads finish.`);
          } catch (e: any) {
            Alert.alert('Import failed', e.message ?? 'Could not import playlist');
          } finally {
            setSpotifyImporting(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', marginBottom: 4 },
  heading: { fontSize: 30, lineHeight: 34, letterSpacing: -0.015 },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
    overflow: 'hidden',
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 100,
    borderWidth: 1,
  },
  tabText: { fontSize: 13.5, fontWeight: '500' },
  tabCount: { fontSize: 12, fontWeight: '500' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 1,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  filterRow: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 100,
    borderWidth: 1,
  },
  filterText: { fontSize: 12.5, fontWeight: '500' },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  artistName: { fontSize: 15, fontWeight: '500' },
  artistMeta: { fontSize: 12, marginTop: 2 },
  releaseDot: { width: 6, height: 6, borderRadius: 3 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.1 },
  addLabel: { fontSize: 14, fontWeight: '600' },
  emptyItem: { fontSize: 13, paddingHorizontal: 20, paddingVertical: 12, lineHeight: 20 },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  userBadge: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  slotText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.1 },
  playlistInfo: { flex: 1 },
  playlistName: { fontSize: 15, fontWeight: '500' },
  playlistDate: { fontSize: 15, fontWeight: '500' },
  playlistMeta: { fontSize: 12, marginTop: 2 },
});
