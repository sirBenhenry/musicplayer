import TrackPlayer, { Event } from 'react-native-track-player';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportSkipIfDaily } from './audio';

/**
 * Fallback: if the queue runs out (shouldn't happen with pre-loaded auto-queue,
 * but covers cold-start / edge cases), fetch one song and continue.
 */
async function fetchFallbackTrack(songId: string): Promise<any | null> {
  try {
    const [authRaw, profileId, isCatchallRaw] = await Promise.all([
      AsyncStorage.getItem('auth'),
      AsyncStorage.getItem('activeProfileId'),
      AsyncStorage.getItem('activeProfileIsCatchall'),
    ]);
    if (!authRaw) return null;
    const { token, serverUrl } = JSON.parse(authRaw);
    const qs = new URLSearchParams({ song_id: songId, count: '3', scope: 'profile' });
    if (profileId && isCatchallRaw !== '1') qs.set('profile_id', profileId);
    const r = await fetch(`${serverUrl}/api/v1/queue/auto-radio-batch?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const songs: any[] = data?.songs ?? [];
    if (!songs.length) return null;
    return { songs, serverUrl };
  } catch {
    return null;
  }
}

export async function PlaybackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) =>
    TrackPlayer.seekTo(position),
  );
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    await reportSkipIfDaily();
    TrackPlayer.skipToNext().catch(() => {});
  });
  TrackPlayer.addEventListener(Event.RemotePreviousTrack, async () => {
    const { position } = await TrackPlayer.getProgress();
    if (position > 3) {
      await TrackPlayer.seekTo(0);
    } else {
      await TrackPlayer.skipToPrevious().catch(() => TrackPlayer.seekTo(0));
    }
  });

  // Fallback: if queue is truly empty, fetch a fresh batch and resume
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, async () => {
    const track = await TrackPlayer.getActiveTrack();
    const songId = track?.songId as string | undefined;
    if (!songId) return;

    const result = await fetchFallbackTrack(songId);
    if (!result) return;

    const { songs, serverUrl } = result;
    try {
      const tracks = songs.map((s: any) => ({
        id: s.id,
        url: `${serverUrl}/api/v1/stream/${s.navidrome_id}`,
        title: s.title ?? '',
        artist: s.artist_name ?? s.artist ?? '',
        album: s.album ?? '',
        artwork: `${serverUrl}/api/v1/cover/${s.navidrome_id}`,
        duration: s.duration_sec ?? 0,
        songId: s.id,
        navidromeId: s.navidrome_id,
        playlistId: null,
      }));
      await TrackPlayer.add(tracks);
      await TrackPlayer.skipToNext();
    } catch (e) {
      console.warn('[PlaybackService] fallback auto-radio failed:', e);
    }
  });
}
