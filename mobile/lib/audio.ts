import TrackPlayer, {
  State,
  Event,
  Capability,
  RepeatMode,
  AppKilledPlaybackBehavior,
} from 'react-native-track-player';
import { useStore, Song } from './store';
import * as api from './api';

// Debounce token so rapid successive calls don't race
let _autoQueueFillTimer: ReturnType<typeof setTimeout> | null = null;

let _isSetup = false;
let _lastReportedPct = 0;
let _listenThroughFired = false;
let _activeSongId: string | null = null;
let _activePlaylistId: string | null = null;

export async function setupAudio() {
  if (_isSetup) return;
  _isSetup = true;

  try {
    await TrackPlayer.setupPlayer({
      waitForBuffer: true,
      autoHandleInterruptions: true,
    });
  } catch (e: any) {
    // Already set up (hot reload / StrictMode double-invoke)
    if (!e?.message?.includes('already been set up')) throw e;
  }

  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.Stop,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
    progressUpdateEventInterval: 5,
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
    },
  });

  // Sync RNTP playback state → Zustand
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    useStore.getState().setIsPlaying(state === State.Playing);
  });

  // Sync active track change → Zustand (handles skip, auto-radio, etc.)
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, async (event) => {
    const track = event?.track;
    if (!track) return;
    const songId = track.songId as string;
    const playlistId = (track.playlistId as string | null) ?? null;
    _activeSongId = songId;
    _activePlaylistId = playlistId;
    _lastReportedPct = 0;
    _listenThroughFired = false;

    useStore.getState().setCurrentSong(
      {
        id: songId,
        navidrome_id: track.navidromeId as string,
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: typeof track.album === 'string' ? track.album : undefined,
        duration_sec: (track.duration as number) ?? 0,
        cover_url: track.artwork as string | undefined,
      },
      track.url as string,
      playlistId ?? undefined,
    );
    useStore.getState().setProgress(0);

    const idx = await TrackPlayer.getActiveTrackIndex();
    if (idx !== undefined && idx !== null) {
      useStore.setState({ queueIndex: idx });
    }

    // Consume from explicitQueue as each explicit song plays
    const { explicitQueue } = useStore.getState();
    if (explicitQueue.length > 0) {
      const eqIdx = explicitQueue.findIndex(e => e.id === songId);
      if (eqIdx >= 0) {
        useStore.setState(s => ({ explicitQueue: s.explicitQueue.slice(eqIdx + 1) }));
      }
    }

    // Consume from autoQueue as auto-queued songs play, then refill
    const { autoQueue } = useStore.getState();
    if (autoQueue.length > 0) {
      const aqIdx = autoQueue.findIndex(e => e.id === songId);
      if (aqIdx >= 0) {
        useStore.setState(s => ({ autoQueue: s.autoQueue.slice(aqIdx + 1) }));
      }
    }

    // Refill auto-queue based on the new current song (debounced 500ms)
    if (_autoQueueFillTimer) clearTimeout(_autoQueueFillTimer);
    _autoQueueFillTimer = setTimeout(() => {
      fillAutoQueue(songId).catch(() => {});
    }, 500);
  });

  // Progress → Zustand + backend API calls
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    if (!duration || duration < 1) return;
    const pct = Math.max(0, Math.min(1, position / duration));
    if (pct === 1 && position < 1) return; // junk update on song start
    useStore.getState().setProgress(pct);

    const songId = _activeSongId;
    const playlistId = _activePlaylistId;
    if (!songId) return;

    if (pct > _lastReportedPct + 0.02) {
      _lastReportedPct = pct;
      api.postProgress(songId, playlistId, pct).catch(() => {});
    }

    if (!_listenThroughFired && pct >= 0.9) {
      _listenThroughFired = true;
      api.postListenThrough(songId, playlistId).catch(() => {});
    }
  });
}

// ── Skip-to-delete mechanic ───────────────────────────────────────────────────
// Pressing next on a daily-playlist song before listen-through (90%) counts as a
// skip → marked for end-of-day deletion. Only daily-playlist tracks carry a
// playlistId (see _buildTrack callers), so library/user-playlist skips send nothing.
export async function reportSkipIfDaily(): Promise<void> {
  try {
    const track = await TrackPlayer.getActiveTrack();
    const songId = track?.songId as string | undefined;
    const playlistId = (track?.playlistId as string | null) ?? null;
    if (!songId || !playlistId) return;
    const { position, duration } = await TrackPlayer.getProgress();
    const pct = duration ? Math.min(1, position / duration) : 0;
    if (pct >= 0.9) return; // listen-through already fired — not a skip
    api.postSkip(songId, playlistId, pct).catch(() => {});
  } catch {}
}

// ── Queue helpers (id-based — never index arithmetic) ─────────────────────────

function trackToSong(t: any): Song {
  return {
    id: t.songId as string,
    navidrome_id: t.navidromeId as string,
    title: t.title ?? '',
    artist: t.artist ?? '',
    album: typeof t.album === 'string' ? t.album : undefined,
    duration_sec: (t.duration as number) ?? 0,
  };
}

async function rnptIndexOf(songId: string): Promise<number> {
  const q = await TrackPlayer.getQueue();
  return q.findIndex((t: any) => t.songId === songId);
}

/** Rebuild the Zustand queue mirror from the real RNTP queue. */
async function syncQueueMirror(): Promise<void> {
  const q = await TrackPlayer.getQueue();
  const idx = await TrackPlayer.getActiveTrackIndex();
  useStore.setState({
    queue: q.map(trackToSong),
    queueIndex: idx ?? 0,
  });
}

/**
 * Append auto-radio songs to reach TARGET=5 slots at the queue tail.
 *
 * Smart fill: keeps existing auto songs, only fetches what's missing.
 * Seeds from explicit tail → auto tail → current song.
 * Bans already-queued auto songs to avoid duplicates.
 * Scope: respects the Stay-in-profile / Full-library toggle (store.radioScope).
 */
export async function fillAutoQueue(currentSongId: string): Promise<void> {
  const store = useStore.getState();
  const { activeProfileId, explicitQueue, autoQueue: existingAuto, radioScope } = store;
  const bannedIds = store.getActiveBanIds();

  const TARGET = 5;
  const needed = TARGET - existingAuto.length;
  if (needed <= 0) return;

  // Seed: explicit tail → auto tail → current song
  const explicitTail = explicitQueue[explicitQueue.length - 1];
  const autoTail = existingAuto[existingAuto.length - 1];
  const seedId = explicitTail?.id ?? autoTail?.id ?? currentSongId;

  // Exclude already-queued auto songs from recommendations
  const alreadyQueued = existingAuto.map(s => s.id);
  const allBanned = [...bannedIds, ...alreadyQueued];

  // Profile scope: don't pass profile_id for catchall (its songs have profile_id=NULL
  // in the DB) or when the user chose "Full library" scope.
  const activeProfile = store.profiles.find(p => p.id === activeProfileId);
  const radioProfileId =
    radioScope === 'library' || activeProfile?.is_catchall
      ? undefined
      : (activeProfileId ?? undefined);

  let result: { songs: any[] };
  try {
    result = await api.getAutoRadioBatch(seedId, needed, radioProfileId, 'profile', allBanned);
  } catch {
    return;
  }

  const newSongs: Song[] = result.songs.map((s: any) => ({
    id: s.id,
    navidrome_id: s.navidrome_id,
    title: s.title,
    artist: s.artist_name ?? s.artist ?? '',
    duration_sec: s.duration_sec ?? 0,
    artist_id: s.artist_id,
    album_id: s.album_id,
  }));

  if (!newSongs.length) return;

  // Always append at end — inserting by position would interleave with playlist songs
  const tracks = newSongs.map(s => _buildTrack(s, null));
  await TrackPlayer.add(tracks);

  store.setAutoQueue([...existingAuto, ...newSongs]);
  await syncQueueMirror();
}

function _buildTrack(song: {
  id: string;
  navidrome_id: string;
  title: string;
  artist: string;
  album?: string;
  duration_sec: number;
}, playlistId: string | null) {
  return {
    id: song.id,
    url: api.getStreamUrl(song.navidrome_id),
    title: song.title,
    artist: song.artist,
    album: song.album ?? '',
    artwork: song.navidrome_id ? api.getCoverUrl(song.navidrome_id) : undefined,
    duration: song.duration_sec,
    // custom fields for service / event handlers
    songId: song.id,
    navidromeId: song.navidrome_id,
    playlistId,
  };
}

/**
 * Play a song within its context (the list it was tapped in).
 *
 * `contextSongs` is REQUIRED for correct behavior whenever the song belongs to a
 * list (playlist, library, artist page) — callers must pass the full visible list.
 * Without it the song plays alone (plus explicit queue + auto-radio).
 *
 * `playlistId` is set ONLY on the context songs (daily-playlist mechanics);
 * spliced-in explicit-queue songs never inherit it.
 */
export async function playSong(
  song: { id: string; navidrome_id: string; title: string; artist: string; album?: string; duration_sec: number },
  streamUrl: string,
  playlistId: string | null,
  contextSongs?: Song[],
) {
  const { explicitQueue } = useStore.getState();

  const base: Song[] = contextSongs && contextSongs.length ? contextSongs : [song as Song];
  const targetIdx = Math.max(0, base.findIndex((s) => s.id === song.id));
  const contextIds = new Set(base.map((s) => s.id));

  // Splice explicit queue right after the tapped song so they play next
  const before = base.slice(0, targetIdx + 1);
  const after = base.slice(targetIdx + 1);
  const merged = [...before, ...explicitQueue, ...after];

  // Clear auto-queue — will be refilled after playback starts
  useStore.setState({ autoQueue: [] });

  await TrackPlayer.reset();
  await TrackPlayer.add(merged.map((s) =>
    _buildTrack(s, contextIds.has(s.id) ? playlistId : null)));

  if (targetIdx > 0) {
    await TrackPlayer.skip(targetIdx);
  }

  await TrackPlayer.play();

  // Update Zustand immediately (event will also fire but this avoids UI flicker)
  useStore.getState().setCurrentSong(song, streamUrl, playlistId ?? undefined);
  useStore.setState({ queue: merged, queueIndex: targetIdx });

  // Pre-load auto-radio songs in background (non-blocking)
  fillAutoQueue(song.id).catch(() => {});
}

export async function togglePlay() {
  const { state } = await TrackPlayer.getPlaybackState();
  if (state === State.Playing) {
    await TrackPlayer.pause();
    useStore.getState().setIsPlaying(false);
  } else {
    await TrackPlayer.play();
    useStore.getState().setIsPlaying(true);
  }
}

export async function seek(pct: number) {
  const { duration } = await TrackPlayer.getProgress();
  if (!duration) return;
  await TrackPlayer.seekTo(pct * duration);
  useStore.getState().setProgress(pct);
}

export async function skipToNext() {
  await reportSkipIfDaily();
  try {
    await TrackPlayer.skipToNext();
  } catch {
    // End of queue — PlaybackService handles auto-radio via PlaybackQueueEnded
  }
}

export async function skipToPrev() {
  const { position } = await TrackPlayer.getProgress();
  if (position > 3) {
    await TrackPlayer.seekTo(0);
    useStore.getState().setProgress(0);
  } else {
    try {
      await TrackPlayer.skipToPrevious();
    } catch {
      await TrackPlayer.seekTo(0);
      useStore.getState().setProgress(0);
    }
  }
}

export async function stop() {
  await TrackPlayer.reset();
  useStore.getState().setIsPlaying(false);
}

/** Cycle repeat mode: off → queue → track → off. Returns the new mode. */
export async function cycleRepeatMode(): Promise<'off' | 'queue' | 'track'> {
  const cur = useStore.getState().repeatMode;
  const next = cur === 'off' ? 'queue' : cur === 'queue' ? 'track' : 'off';
  const rntp = next === 'off' ? RepeatMode.Off : next === 'queue' ? RepeatMode.Queue : RepeatMode.Track;
  await TrackPlayer.setRepeatMode(rntp);
  useStore.getState().setRepeatMode(next);
  return next;
}

/** Shuffle the not-yet-played remainder of the queue (Fisher–Yates via RNTP moves). */
export async function shuffleUpcoming(): Promise<void> {
  const idx = (await TrackPlayer.getActiveTrackIndex()) ?? 0;
  const q = await TrackPlayer.getQueue();
  const n = q.length;
  if (n - (idx + 1) < 2) return;
  for (let i = n - 1; i > idx + 1; i--) {
    const j = idx + 1 + Math.floor(Math.random() * (i - idx));
    if (i !== j) await TrackPlayer.move(i, j);
  }
  // Order changed → the explicit/auto bookkeeping no longer reflects position;
  // keep the song sets but rebuild the visible queue mirror.
  await syncQueueMirror();
}

export async function addToQueue(song: Song) {
  const { explicitQueue } = useStore.getState();
  const current = await TrackPlayer.getActiveTrack();

  if (!current) {
    // Nothing playing — start fresh with this song
    useStore.setState({ autoQueue: [] });
    await TrackPlayer.reset();
    await TrackPlayer.add(_buildTrack(song, null));
    await TrackPlayer.play();
    useStore.setState({ queue: [song], queueIndex: 0, explicitQueue: [] });
    fillAutoQueue(song.id).catch(() => {});
    return;
  }

  // Insert after the last explicit song, or right after the current track.
  const lastExplicit = explicitQueue[explicitQueue.length - 1];
  let anchorIdx = lastExplicit ? await rnptIndexOf(lastExplicit.id) : -1;
  if (anchorIdx < 0) anchorIdx = await rnptIndexOf(current.songId as string);
  if (anchorIdx < 0) anchorIdx = (await TrackPlayer.getQueue()).length - 1;

  await TrackPlayer.add(_buildTrack(song, null), anchorIdx + 1);
  useStore.setState(s => ({ explicitQueue: [...s.explicitQueue, song] }));
  await syncQueueMirror();

  // Top up auto-radio from the new explicit tail
  fillAutoQueue(song.id).catch(() => {});
}

export async function removeFromExplicitQueue(index: number) {
  const { explicitQueue } = useStore.getState();
  const song = explicitQueue[index];
  if (!song) return;
  const rnptIdx = await rnptIndexOf(song.id);
  if (rnptIdx >= 0) await TrackPlayer.remove([rnptIdx]);
  useStore.setState(s => ({
    explicitQueue: s.explicitQueue.filter((_, i) => i !== index),
  }));
  await syncQueueMirror();
}

export async function moveInExplicitQueue(from: number, to: number) {
  if (from === to) return;
  const { explicitQueue } = useStore.getState();
  const fromSong = explicitQueue[from];
  const toSong = explicitQueue[to];
  if (!fromSong || !toSong) return;
  const rnptFrom = await rnptIndexOf(fromSong.id);
  const rnptTo = await rnptIndexOf(toSong.id);
  if (rnptFrom < 0 || rnptTo < 0) return;
  await TrackPlayer.move(rnptFrom, rnptTo);
  useStore.setState(s => {
    const newExplicit = [...s.explicitQueue];
    const [item] = newExplicit.splice(from, 1);
    newExplicit.splice(to, 0, item);
    return { explicitQueue: newExplicit };
  });
  await syncQueueMirror();
}

/** Remove an auto-radio song from the queue by id (queue sheet). */
export async function removeAutoSong(songId: string) {
  const rnptIdx = await rnptIndexOf(songId);
  if (rnptIdx >= 0) await TrackPlayer.remove([rnptIdx]);
  useStore.setState(s => ({ autoQueue: s.autoQueue.filter(a => a.id !== songId) }));
  await syncQueueMirror();
}
