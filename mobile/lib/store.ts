import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Song {
  id: string;
  navidrome_id: string;
  title: string;
  artist: string;
  album?: string;
  duration_sec: number;
  cover_url?: string;
  artist_id?: string;
  album_id?: string;
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  glyph: string;
  hue: number;
  is_catchall: boolean;
  daily_auto_generate: boolean;
}

interface AppStore {
  // Auth
  token: string | null;
  serverUrl: string;
  setAuth: (token: string, serverUrl: string) => void;
  setServerUrl: (url: string) => void;
  clearAuth: () => void;

  // Profile
  activeProfileId: string | null;
  profiles: Profile[];
  setActiveProfile: (id: string, isCatchall?: boolean) => void;
  setProfiles: (profiles: Profile[]) => void;

  // Playback
  currentSong: Song | null;
  isPlaying: boolean;
  progress: number;
  playerOpen: boolean;
  streamUrl: string | null;
  playlistId: string | null;
  setCurrentSong: (song: Song, streamUrl: string, playlistId?: string) => void;
  setIsPlaying: (v: boolean) => void;
  setProgress: (v: number) => void;
  setPlayerOpen: (v: boolean) => void;

  // Queue
  queue: Song[];
  queueIndex: number;
  explicitQueue: Song[];
  setExplicitQueue: (songs: Song[]) => void;

  // Auto-radio pre-queue
  autoQueue: Song[];
  setAutoQueue: (songs: Song[]) => void;
  // Short-ban: song IDs removed from queue — excluded for 30 min, session-only
  // Record<songId, expiresAtMs>
  shortBans: Record<string, number>;
  addShortBan: (id: string) => void;
  getActiveBanIds: () => string[];

  // Playback preferences
  radioScope: 'profile' | 'library';
  setRadioScope: (s: 'profile' | 'library') => void;
  repeatMode: 'off' | 'queue' | 'track';
  setRepeatMode: (m: 'off' | 'queue' | 'track') => void;

  // Theme
  isDark: boolean;
  isSage: boolean;
  toggleDark: () => void;
  toggleSage: () => void;

  // UI overlays
  profileMenuOpen: boolean;
  setProfileMenuOpen: (v: boolean) => void;
  queueOpen: boolean;
  setQueueOpen: (v: boolean) => void;

  // Notification badge
  notificationCount: number;
  setNotificationCount: (n: number) => void;

  // Hydration
  hydrate: () => Promise<void>;
}

export const useStore = create<AppStore>((set, get) => ({
  token: null,
  serverUrl: '',
  setAuth: (token, serverUrl) => {
    set({ token, serverUrl });
    AsyncStorage.setItem('auth', JSON.stringify({ token, serverUrl }));
  },
  setServerUrl: (url) => {
    const token = get().token;
    set({ serverUrl: url });
    AsyncStorage.setItem('auth', JSON.stringify({ token, serverUrl: url }));
  },
  clearAuth: () => {
    set({ token: null, serverUrl: '' });
    AsyncStorage.removeItem('auth');
  },

  activeProfileId: null,
  profiles: [],
  setActiveProfile: (id, isCatchall = false) => {
    set({ activeProfileId: id });
    AsyncStorage.setItem('activeProfileId', id);
    AsyncStorage.setItem('activeProfileIsCatchall', isCatchall ? '1' : '0');
  },
  setProfiles: (profiles) => set({ profiles }),

  currentSong: null,
  isPlaying: false,
  progress: 0,
  playerOpen: false,
  streamUrl: null,
  playlistId: null,
  setCurrentSong: (song, streamUrl, playlistId) =>
    set({ currentSong: song, streamUrl, playlistId: playlistId ?? null, progress: 0 }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setProgress: (v) => set({ progress: v }),
  setPlayerOpen: (v) => set({ playerOpen: v }),

  queue: [],
  queueIndex: 0,
  explicitQueue: [],
  setExplicitQueue: (songs) => set({ explicitQueue: songs }),

  autoQueue: [],
  setAutoQueue: (songs) => set({ autoQueue: songs }),

  shortBans: {},
  addShortBan: (id) => set((s) => ({
    shortBans: { ...s.shortBans, [id]: Date.now() + 30 * 60 * 1000 },
  })),
  getActiveBanIds: () => {
    const { shortBans } = get();
    const now = Date.now();
    return Object.entries(shortBans)
      .filter(([, exp]) => exp > now)
      .map(([id]) => id);
  },

  radioScope: 'profile',
  setRadioScope: (s) => {
    set({ radioScope: s });
    AsyncStorage.setItem('radioScope', s);
  },
  repeatMode: 'off',
  setRepeatMode: (m) => set({ repeatMode: m }),

  isDark: false,
  isSage: false,
  toggleDark: () => {
    const v = !get().isDark;
    set({ isDark: v });
    AsyncStorage.setItem('isDark', String(v));
  },
  toggleSage: () => {
    const v = !get().isSage;
    set({ isSage: v });
    AsyncStorage.setItem('isSage', String(v));
  },

  profileMenuOpen: false,
  setProfileMenuOpen: (v) => set({ profileMenuOpen: v }),
  queueOpen: false,
  setQueueOpen: (v) => set({ queueOpen: v }),

  notificationCount: 0,
  setNotificationCount: (n) => set({ notificationCount: n }),

  hydrate: async () => {
    const [auth, profileId, isDark, isSage, radioScope] = await Promise.all([
      AsyncStorage.getItem('auth'),
      AsyncStorage.getItem('activeProfileId'),
      AsyncStorage.getItem('isDark'),
      AsyncStorage.getItem('isSage'),
      AsyncStorage.getItem('radioScope'),
    ]);
    if (auth) {
      const { token, serverUrl } = JSON.parse(auth);
      set({ token, serverUrl });
    }
    if (profileId) set({ activeProfileId: profileId });
    if (isDark) set({ isDark: isDark === 'true' });
    if (isSage) set({ isSage: isSage === 'true' });
    if (radioScope === 'library' || radioScope === 'profile') set({ radioScope });
  },
}));
