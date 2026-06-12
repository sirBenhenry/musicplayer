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
  if (!r.ok) {
    let msg = `${method} ${path} → ${r.status}`;
    try {
      const j = await r.json();
      if (typeof j?.detail === 'string') msg = j.detail;
    } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return undefined as T;
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
export const getLibraryStamp = () =>
  req<{ updated_at: string }>('GET', '/api/v1/songs/stamp');

export const getSongs = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return req<any[]>('GET', `/api/v1/songs${qs}`);
};
export const getSong = (id: string) => req<any>('GET', `/api/v1/songs/${id}`);
export const deleteSong = (id: string) => req<void>('DELETE', `/api/v1/songs/${id}`);
export const setSongProfile = (id: string, profileId: string | null) =>
  req<{ ok: boolean }>('PATCH', `/api/v1/songs/${id}/profile`, { profile_id: profileId });
export const getStreamUrl = (navidromeId: string): string =>
  `${base()}/api/v1/stream/${navidromeId}`;
export const getCoverUrl = (navidromeId: string): string =>
  `${base()}/api/v1/cover/${navidromeId}?v=2`;
export const getArtists = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return req<any[]>('GET', `/api/v1/artists${qs}`);
};
export const getArtist = (id: string) => req<any>('GET', `/api/v1/artists/${id}`);
export const addArtist = (id: string) => req<void>('POST', `/api/v1/artists/${id}/add`);
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
export const consumePlaylist = (id: string) =>
  req<void>('POST', `/api/v1/discovery/playlists/${id}/consume`);
export const flagSong = (playlistId: string, songId: string, action: 'keep' | 'delete') =>
  req<void>('PATCH', `/api/v1/discovery/playlists/${playlistId}/songs/${songId}/flag`, { action });
export const triggerGenerate = () =>
  req<void>('POST', '/api/v1/discovery/generate');
export const notificationAction = (
  notifId: string,
  accept: boolean,
  profileId?: string,
  newProfileName?: string,
) =>
  req<{ status: string; [key: string]: any }>('POST', `/api/v1/notifications/${notifId}/action`, {
    accept,
    profile_id: profileId,
    new_profile_name: newProfileName,
  });

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
export const getAutoRadioBatch = (
  songId: string,
  count = 5,
  profileId?: string,
  scope = 'profile',
  bannedIds: string[] = [],
) => {
  const qs = new URLSearchParams({ song_id: songId, count: String(count), scope });
  if (profileId) qs.set('profile_id', profileId);
  if (bannedIds.length) qs.set('banned_ids', bannedIds.join(','));
  return req<{ songs: any[] }>('GET', `/api/v1/queue/auto-radio-batch?${qs}`);
};

// Artist discovery / import
export const searchNewArtists = (q: string) =>
  req<any[]>('GET', `/api/v1/artists/search?q=${encodeURIComponent(q)}`);
export const importArtist = (body: { mbid: string; name: string; follow?: boolean; download_recordings?: boolean }) =>
  req<any>('POST', '/api/v1/artists/import', body);
export const downloadAllArtist = (artistId: string) =>
  req<any>('POST', `/api/v1/artists/${artistId}/download-all`);

// Track search + individual download
export const searchTracks = (q: string, filter = 'all') =>
  req<any[]>('GET', `/api/v1/tracks/search?q=${encodeURIComponent(q)}&search_filter=${filter}`);

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
export const downloadTrack = (body: { title: string; artist: string; mb_recording_id?: string; profile_id?: string }) =>
  req<any>('POST', '/api/v1/tracks/download', body);

// User playlists
export const getUserPlaylists = () => req<any[]>('GET', '/api/v1/playlists');
export const createUserPlaylist = (name: string) => req<any>('POST', '/api/v1/playlists', { name });
export const getUserPlaylist = (id: string) => req<any>('GET', `/api/v1/playlists/${id}`);
export const renameUserPlaylist = (id: string, name: string) => req<any>('PUT', `/api/v1/playlists/${id}`, { name });
export const deleteUserPlaylist = (id: string) => req<void>('DELETE', `/api/v1/playlists/${id}`);
export const addSongToPlaylist = (playlistId: string, songId: string) =>
  req<any>('POST', `/api/v1/playlists/${playlistId}/songs`, { song_id: songId });
export const removeSongFromPlaylist = (playlistId: string, songId: string) =>
  req<any>('DELETE', `/api/v1/playlists/${playlistId}/songs/${songId}`);

// Download management
export const getDownloads = (status?: string, page = 1, limit = 50) => {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) qs.set('status', status);
  return req<any[]>('GET', `/api/v1/downloads?${qs}`);
};
export const getFailedDownloads = () => req<any[]>('GET', '/api/v1/downloads/failed');
export const retryDownload = (id: string) => req<any>('POST', `/api/v1/downloads/${id}/retry`);
export const cancelDownload = (id: string) => req<any>('POST', `/api/v1/downloads/${id}/cancel`);
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

// Import
export const importSpotifyPlaylist = (url: string, profile_id?: string) =>
  req<{ playlist_id: string; name: string; track_count: number; jobs: any[] }>(
    'POST', '/api/v1/playlists/import-spotify', { url, profile_id }
  );
export const importSongs = (songs: { artist: string; title: string; mb_recording_id?: string }[]) =>
  req<{ total: number; jobs: any[] }>('POST', '/api/v1/admin/import-songs', songs);
export const importSetup = (body: any) =>
  req<{ profiles_created: number; songs_queued: number; playlists_created: number; playlist_songs_queued: number }>(
    'POST', '/api/v1/admin/import-setup', body
  );

export const getImportGuideUrl = (): string =>
  `${useStore.getState().serverUrl}/api/v1/admin/import-guide`;

export const exportLibrary = () =>
  req<{ exported_at: string; profiles: any[]; songs: any[] }>('GET', '/api/v1/admin/export-library');

export const applyLibraryChanges = (songs: { id: string; profile?: string | null; delete?: boolean }[]) =>
  req<{ assigned: number; deleted: number; errors: string[] }>('POST', '/api/v1/admin/apply-library', { songs });

export const sendDeviceLogs = (logs: string) =>
  req<void>('POST', '/api/v1/admin/device-logs', { logs });

export const getAnalysisStatus = () =>
  req<{
    total: number;
    completed: number;
    queued: number;
    failed: number;
    in_progress: number;
    songs_in_progress: Array<{ id: string; title: string; artist: string }>;
    songs_queued: Array<{ id: string; title: string; artist: string }>;
    songs_failed: Array<{ id: string; title: string; artist: string }>;
  }>('GET', '/api/v1/admin/analysis-status');

export const retryFailedAnalysis = () =>
  req<{ reset: number }>('POST', '/api/v1/admin/analysis-retry-failed');

export const getSystemStatus = () =>
  req<{
    services: Array<{ name: string; ok: boolean; error?: string; version?: string; active_searches?: number; dl_speed?: number; up_speed?: number; active_torrents?: number }>;
    storage: { music_bytes?: number; music_files?: number; disk_total_bytes?: number; disk_free_bytes?: number; error?: string };
    library: { songs: number; artists: number; albums: number };
    downloads: { queued: number; downloading: number; failed: number };
  }>('GET', '/api/v1/admin/system-status');
