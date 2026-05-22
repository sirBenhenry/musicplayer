import { useStore } from './store';

function base() {
  return useStore.getState().serverUrl;
}

function headers(): Record<string, string> {
  const token = useStore.getState().token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    method,
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
  return r.json();
}

// Auth
export const login = (username: string, password: string) =>
  req<{ access_token: string }>('POST', '/api/v1/auth/login', { username, password });

// Profiles
export const getProfiles = () => req<any[]>('GET', '/api/v1/profiles');
export const createProfile = (data: any) => req<any>('POST', '/api/v1/profiles', data);
export const updateProfile = (id: string, data: any) => req<any>('PUT', `/api/v1/profiles/${id}`, data);
export const deleteProfile = (id: string) => req<void>('DELETE', `/api/v1/profiles/${id}`);

// Library
export const getSongs = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return req<any[]>('GET', `/api/v1/songs${qs}`);
};
export const getSong = (id: string) => req<any>('GET', `/api/v1/songs/${id}`);
export const getStreamUrl = (navidromeId: string): string =>
  `${base()}/api/v1/stream/${navidromeId}`;
export const getCoverUrl = (navidromeId: string): string =>
  `${base()}/api/v1/cover/${navidromeId}`;
export const getArtists = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return req<any[]>('GET', `/api/v1/artists${qs}`);
};
export const getArtist = (id: string) => req<any>('GET', `/api/v1/artists/${id}`);
export const followArtist = (id: string) => req<void>('POST', `/api/v1/artists/${id}/follow`);
export const unfollowArtist = (id: string) => req<void>('DELETE', `/api/v1/artists/${id}/follow`);
export const getAlbums = () => req<any[]>('GET', '/api/v1/albums');

// Discovery
export const getTodayPlaylists = (profileId?: string) => {
  const qs = profileId ? `?profile_id=${profileId}` : '';
  return req<any[]>('GET', `/api/v1/discovery/today${qs}`);
};
export const getPlaylists = (profileId?: string) => {
  const qs = profileId ? `?profile_id=${profileId}` : '';
  return req<any[]>('GET', `/api/v1/discovery/playlists${qs}`);
};
export const getPlaylist = (id: string) => req<any>('GET', `/api/v1/discovery/playlists/${id}`);
export const pausePlaylist = (id: string) =>
  req<void>('POST', `/api/v1/discovery/playlists/${id}/pause`);
export const triggerGenerate = (profileId: string) =>
  req<void>('POST', `/api/v1/discovery/generate?profile_id=${profileId}`);

// Playback events
export const postProgress = (songId: string, playlistId: string | null, progressPct: number) =>
  req<void>('POST', '/api/v1/playback/progress', {
    song_id: songId, playlist_id: playlistId, progress_pct: progressPct,
  });
export const postSkip = (songId: string, playlistId: string | null, progressPct: number) =>
  req<void>('POST', '/api/v1/playback/skip', {
    song_id: songId, playlist_id: playlistId, progress_pct: progressPct,
  });
export const postListenThrough = (songId: string, playlistId: string | null) =>
  req<void>('POST', '/api/v1/playback/listen-through', {
    song_id: songId, playlist_id: playlistId,
  });

// Deletion
export const getPendingDeletions = () => req<any[]>('GET', '/api/v1/deletion/pending');
export const rescueSong = (songId: string) =>
  req<void>('POST', `/api/v1/deletion/${songId}/rescue`);

// History
export const getHistory = (limit = 30) =>
  req<any[]>('GET', `/api/v1/history?limit=${limit}`);

// Queue / auto-radio
export const getAutoRadio = (songId: string, profileId?: string, scope = 'profile') => {
  const qs = new URLSearchParams({ song_id: songId, scope });
  if (profileId) qs.set('profile_id', profileId);
  return req<any>('GET', `/api/v1/queue/auto-radio?${qs}`);
};
export const getQueue = () => req<any>('GET', '/api/v1/queue');
export const appendQueue = (songId: string) =>
  req<void>('POST', '/api/v1/queue/append', { song_id: songId });

// Artist discovery / import
export const searchNewArtists = (q: string) =>
  req<any[]>('GET', `/api/v1/artists/search?q=${encodeURIComponent(q)}`);
export const importArtist = (body: { mbid: string; name: string }) =>
  req<any>('POST', '/api/v1/artists/import', body);
export const downloadAllArtist = (artistId: string) =>
  req<any>('POST', `/api/v1/artists/${artistId}/download-all`);

// Track search + individual download
export const searchTracks = (q: string) =>
  req<any[]>('GET', `/api/v1/tracks/search?q=${encodeURIComponent(q)}`);

// iTunes Search API — popularity-ranked, no auth, CORS-safe in React Native
export async function searchTracksItunes(q: string): Promise<any[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=25`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`iTunes search ${r.status}`);
  const data = await r.json();
  return (data.results ?? []).map((t: any) => ({
    title: t.trackName ?? '',
    artist: t.artistName ?? '',
    album: t.collectionName ?? '',
    artwork_url: t.artworkUrl100 ?? null,
    itunes_id: t.trackId,
    mb_recording_id: undefined,
  }));
}
export const downloadTrack = (body: { title: string; artist: string; mb_recording_id?: string }) =>
  req<any>('POST', '/api/v1/tracks/download', body);

// Download management
export const getDownloads = (status?: string, page = 1, limit = 50) => {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) qs.set('status', status);
  return req<any[]>('GET', `/api/v1/downloads?${qs}`);
};
export const getFailedDownloads = () => req<any[]>('GET', '/api/v1/downloads/failed');
export const retryDownload = (id: string) => req<any>('POST', `/api/v1/downloads/${id}/retry`);
export const deleteDownload = (id: string) => req<void>('DELETE', `/api/v1/downloads/${id}`);
export const getDownloadPipeline = (id: string) =>
  req<any>('GET', `/api/v1/downloads/${id}/pipeline`);
export const reviewDownload = (id: string, action: 'confirm' | 'wrong_song' | 'bad_quality') =>
  req<any>('POST', `/api/v1/downloads/${id}/review`, { action });

// Notifications
export const getNotifications = () => req<any[]>('GET', '/api/v1/notifications');
export const getNotificationCount = () => req<{ count: number }>('GET', '/api/v1/notifications/count');
export const dismissNotification = (id: string) =>
  req<any>('POST', `/api/v1/notifications/${id}/dismiss`);
export const dismissAllNotifications = () =>
  req<any>('POST', '/api/v1/notifications/dismiss-all');
