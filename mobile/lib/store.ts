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
  setActiveProfile: (id: string) => void;
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
  setQueue: (songs: Song[], index?: number) => void;
  appendToQueue: (song: Song) => void;

  // Theme
  isDark: boolean;
  isSage: boolean;
  toggleDark: () => void;
  toggleSage: () => void;

  // UI overlays
  profileMenuOpen: boolean;
  setProfileMenuOpen: (v: boolean) => void;

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
  setActiveProfile: (id) => {
    set({ activeProfileId: id });
    AsyncStorage.setItem('activeProfileId', id);
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
  setQueue: (songs, index = 0) => set({ queue: songs, queueIndex: index }),
  appendToQueue: (song) => set((s) => ({ queue: [...s.queue, song] })),

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

  hydrate: async () => {
    const [auth, profileId, isDark, isSage] = await Promise.all([
      AsyncStorage.getItem('auth'),
      AsyncStorage.getItem('activeProfileId'),
      AsyncStorage.getItem('isDark'),
      AsyncStorage.getItem('isSage'),
    ]);
    if (auth) {
      const { token, serverUrl } = JSON.parse(auth);
      set({ token, serverUrl });
    }
    if (profileId) set({ activeProfileId: profileId });
    if (isDark) set({ isDark: isDark === 'true' });
    if (isSage) set({ isSage: isSage === 'true' });
  },
}));
