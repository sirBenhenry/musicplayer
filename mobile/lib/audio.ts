import TrackPlayer, {
  State,
  Event,
  Capability,
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

/**
 * Fetch the next N auto-radio songs from the current song and pre-load them
 * into RNTP after any explicit queue items.
 *
 * Called on: song change, playSong, addToQueue (explicit).
 * Replaces any existing auto-queued tracks in RNTP.
 */
export async function fillAutoQueue(currentSongId: string): Promise<void> {
  const store = useStore.getState();
  const { activeProfileId, queueIndex, explicitQueue, autoQueue: prevAutoQueue } = store;
  const bannedIds = store.getActiveBanIds();

  // How many auto slots do we want (always aim for 5)
  const TARGET = 5;
  // The "seed" for recommendations is the last explicit song if queue non-empty, else current
  const explicitTail = explicitQueue[explicitQueue.length - 1];
  const seedId = explicitTail?.id ?? currentSongId;

  let result: { songs: any[] };
  try {
    result = await api.getAutoRadioBatch(seedId, TARGET, activeProfileId ?? undefined, 'profile', bannedIds);
  } catch {
    return;
  }

  const newAutoSongs: Song[] = result.songs.map((s: any) => ({
    id: s.id,
    navidrome_id: s.navidrome_id,
    title: s.title,
    artist: s.artist_name ?? s.artist ?? '',
    duration_sec: s.duration_sec ?? 0,
    artist_id: s.artist_id,
    album_id: s.album_id,
  }));

  // Remove old auto-queued tracks from RNTP (they sit after explicit queue)
  const rnptQueue = await TrackPlayer.getQueue();
  const currentIdx = await TrackPlayer.getActiveTrackIndex() ?? 0;
  const insertAt = currentIdx + 1 + explicitQueue.length;

  // Remove old auto-radio tracks (anything after explicit queue end)
  const oldAutoCount = prevAutoQueue.length;
  if (oldAutoCount > 0) {
    const toRemove = Array.from({ length: oldAutoCount }, (_, i) => insertAt + i)
      .filter(i => i < rnptQueue.length);
    if (toRemove.length > 0) {
      await TrackPlayer.remove(toRemove);
    }
  }

  // Add new auto-queued tracks
  if (newAutoSongs.length > 0) {
    const tracks = newAutoSongs.map(s => _buildTrack(s, null));
    await TrackPlayer.add(tracks, insertAt);
  }

  store.setAutoQueue(newAutoSongs);
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

export async function playSong(
  song: { id: string; navidrome_id: string; title: string; artist: string; album?: string; duration_sec: number },
  streamUrl: string,
  playlistId: string | null,
) {
  const { queue, explicitQueue } = useStore.getState();

  const contextSongs = queue.length > 0 ? queue : [song];
  const targetIdx = Math.max(0, contextSongs.findIndex((s) => s.id === song.id));

  // Splice explicit queue right after the current song so they play next
  const before = contextSongs.slice(0, targetIdx + 1);
  const after = contextSongs.slice(targetIdx + 1);
  const merged = [...before, ...explicitQueue, ...after];

  // Clear auto-queue — will be refilled after playback starts
  useStore.setState({ autoQueue: [] });

  await TrackPlayer.reset();
  await TrackPlayer.add(merged.map((s) => _buildTrack(s, playlistId)));

  if (targetIdx > 0) {
    await TrackPlayer.skip(targetIdx);
  }

  await TrackPlayer.play();

  // Update Zustand immediately (event will also fire but this avoids UI flicker)
  useStore.getState().setCurrentSong(song, streamUrl, playlistId ?? undefined);
  // Sync merged queue so nextSong display in FullPlayer reflects explicit queue order
  useStore.setState({ queue: merged, queueIndex: targetIdx });

  // Pre-load auto-radio songs in background (non-blocking)
  fillAutoQueue(song.id).catch(() => {});
}

export async function togglePlay() {
  const state = await TrackPlayer.getState();
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

export async function addToQueue(song: Song) {
  const { queue, queueIndex, explicitQueue, autoQueue } = useStore.getState();
  const track = _buildTrack(song, null);

  if (queue.length === 0) {
    useStore.setState({ autoQueue: [] });
    await TrackPlayer.reset();
    await TrackPlayer.add(track);
    useStore.setState({ queue: [song], queueIndex: 0, explicitQueue: [song] });
    fillAutoQueue(song.id).catch(() => {});
    return;
  }

  // Remove existing auto-radio tracks from RNTP first (they'll be recalculated)
  const insertAt = queueIndex + 1 + explicitQueue.length;
  const oldAutoCount = autoQueue.length;
  if (oldAutoCount > 0) {
    const rnptQueue = await TrackPlayer.getQueue();
    const toRemove = Array.from({ length: oldAutoCount }, (_, i) => insertAt + i)
      .filter(i => i < rnptQueue.length);
    if (toRemove.length > 0) await TrackPlayer.remove(toRemove);
    useStore.setState({ autoQueue: [] });
  }

  // Insert explicit song at correct position
  await TrackPlayer.add(track, insertAt);
  useStore.setState(s => {
    const newQueue = [...s.queue];
    newQueue.splice(insertAt, 0, song);
    return { queue: newQueue, explicitQueue: [...s.explicitQueue, song] };
  });

  // Refill auto-queue from the new tail of the explicit queue
  fillAutoQueue(song.id).catch(() => {});
}

export async function removeFromExplicitQueue(index: number) {
  const { queueIndex, explicitQueue } = useStore.getState();
  if (index >= explicitQueue.length) return;
  const rnptIdx = queueIndex + 1 + index;
  await TrackPlayer.remove([rnptIdx]);
  useStore.setState(s => ({
    queue: s.queue.filter((_, i) => i !== rnptIdx),
    explicitQueue: s.explicitQueue.filter((_, i) => i !== index),
  }));
}

export async function moveInExplicitQueue(from: number, to: number) {
  if (from === to) return;
  const { queueIndex } = useStore.getState();
  const rnptFrom = queueIndex + 1 + from;
  const rnptTo = queueIndex + 1 + to;
  await TrackPlayer.move(rnptFrom, rnptTo);
  useStore.setState(s => {
    const newQueue = [...s.queue];
    const [qItem] = newQueue.splice(rnptFrom, 1);
    newQueue.splice(rnptTo, 0, qItem);
    const newExplicit = [...s.explicitQueue];
    const [eItem] = newExplicit.splice(from, 1);
    newExplicit.splice(to, 0, eItem);
    return { queue: newQueue, explicitQueue: newExplicit };
  });
}
