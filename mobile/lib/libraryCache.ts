import AsyncStorage from '@react-native-async-storage/async-storage';

const K = {
  songs: '@lib/songs/v2',
  artists: '@lib/artists/v2',
  stamp: '@lib/stamp/v2',
};

async function load<T>(key: keyof typeof K): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(K[key]);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function save(key: keyof typeof K, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(K[key], JSON.stringify(data));
  } catch {}
}

export const libraryCache = {
  loadSongs: () => load<any[]>('songs').then(d => d ?? []),
  saveSongs: (songs: any[]) => save('songs', songs),
  loadArtists: () => load<any[]>('artists').then(d => d ?? []),
  saveArtists: (artists: any[]) => save('artists', artists),
  getStamp: () => load<string>('stamp'),
  saveStamp: (stamp: string) => save('stamp', stamp),
};
