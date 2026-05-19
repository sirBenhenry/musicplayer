import { Audio } from 'expo-av';
import { useStore } from './store';
import * as api from './api';

let _sound: Audio.Sound | null = null;
let _progressInterval: ReturnType<typeof setInterval> | null = null;
let _lastReportedProgress = 0;
let _listenThroughFired = false;

export async function setupAudio() {
  await Audio.setAudioModeAsync({
    staysActiveInBackground: true,
    playsInSilentModeIOS: true,
  });
}

export async function playSong(
  song: { id: string; navidrome_id: string; title: string; artist: string; duration_sec: number },
  streamUrl: string,
  playlistId: string | null,
) {
  await stop();
  _lastReportedProgress = 0;
  _listenThroughFired = false;

  const store = useStore.getState();
  store.setCurrentSong(
    { ...song, artist: song.artist, duration_sec: song.duration_sec },
    streamUrl,
    playlistId ?? undefined,
  );
  store.setProgress(0);

  const { sound } = await Audio.Sound.createAsync(
    { uri: streamUrl },
    { shouldPlay: true },
    (status) => {
      if (!status.isLoaded) return;
      const dur = status.durationMillis ?? (song.duration_sec * 1000);
      const pos = status.positionMillis ?? 0;
      const pct = dur > 0 ? pos / dur : 0;
      useStore.getState().setProgress(pct);

      if (!_listenThroughFired && pct >= 0.9) {
        _listenThroughFired = true;
        api.postListenThrough(song.id, playlistId).catch(() => {});
      }

      if (status.didJustFinish) {
        useStore.getState().setIsPlaying(false);
        advanceQueue();
      }
    },
  );

  _sound = sound;
  store.setIsPlaying(true);

  _progressInterval = setInterval(async () => {
    const pct = useStore.getState().progress;
    if (pct > _lastReportedProgress + 0.02) {
      _lastReportedProgress = pct;
      api.postProgress(song.id, playlistId, pct).catch(() => {});
    }
  }, 5000);
}

export async function togglePlay() {
  if (!_sound) return;
  const status = await _sound.getStatusAsync();
  if (!status.isLoaded) return;
  if (status.isPlaying) {
    await _sound.pauseAsync();
    useStore.getState().setIsPlaying(false);
  } else {
    await _sound.playAsync();
    useStore.getState().setIsPlaying(true);
  }
}

export async function seek(pct: number) {
  if (!_sound) return;
  const status = await _sound.getStatusAsync();
  if (!status.isLoaded || !status.durationMillis) return;
  await _sound.setPositionAsync(Math.floor(pct * status.durationMillis));
  useStore.getState().setProgress(pct);
}

export async function stop() {
  if (_progressInterval) {
    clearInterval(_progressInterval);
    _progressInterval = null;
  }
  if (_sound) {
    await _sound.unloadAsync();
    _sound = null;
  }
  useStore.getState().setIsPlaying(false);
}

async function advanceQueue() {
  const { queue, queueIndex, activeProfileId } = useStore.getState();
  if (queueIndex + 1 < queue.length) {
    const next = queue[queueIndex + 1];
    useStore.setState({ queueIndex: queueIndex + 1 });
    const url = api.getStreamUrl(next.navidrome_id);
    await playSong(next, url, null);
    return;
  }

  const current = useStore.getState().currentSong;
  if (!current) return;
  try {
    const next = await api.getAutoRadio(current.id, activeProfileId ?? undefined);
    if (next?.navidrome_id) {
      const url = api.getStreamUrl(next.navidrome_id);
      await playSong({ ...next, artist: next.artist_name ?? '', duration_sec: next.duration_sec ?? 0 }, url, null);
    }
  } catch {
    /* no more songs */
  }
}
