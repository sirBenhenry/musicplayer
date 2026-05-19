import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from '@expo-google-fonts/geist';
import { useStore } from '../lib/store';
import { setupAudio } from '../lib/audio';
import { MiniPlayer } from '../components/chrome/MiniPlayer';
import { FullPlayer } from '../components/player/FullPlayer';
import { useTheme } from '../hooks/useTheme';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token } = useStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const inAuth = segments[0] === 'login';
    if (!token && !inAuth) {
      router.replace('/login');
    } else if (token && inAuth) {
      router.replace('/');
    }
  }, [token, segments]);

  return <>{children}</>;
}

export default function RootLayout() {
  const theme = useTheme();
  const { playerOpen, setPlayerOpen, hydrate } = useStore();

  const [fontsLoaded] = useFonts({
    Geist: Geist_400Regular,
    GeistMedium: Geist_500Medium,
    GeistSemiBold: Geist_600SemiBold,
  });

  useEffect(() => {
    hydrate();
    setupAudio();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
          <AuthGuard>
            <Stack screenOptions={{ headerShown: false }} />
          </AuthGuard>

          <MiniPlayer onPress={() => setPlayerOpen(true)} />

          {playerOpen && (
            <FullPlayer onClose={() => setPlayerOpen(false)} />
          )}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
