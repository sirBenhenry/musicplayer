import React, { Component, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import { useStore } from '../lib/store';
import { setupAudio } from '../lib/audio';
import { getProfiles } from '../lib/api';
import { FullPlayer } from '../components/player/FullPlayer';
import { QueueSheet } from '../components/player/QueueSheet';
import { useTheme } from '../hooks/useTheme';

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const msg = (this.state.error as Error).message;
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#f4ede2' }}>
          <Text style={{ fontSize: 16, color: '#b8553a', fontWeight: '600', marginBottom: 8 }}>Something went wrong</Text>
          <Text style={{ fontSize: 12, color: '#6e655a', marginBottom: 20, textAlign: 'center' }}>{msg}</Text>
          <TouchableOpacity
            onPress={() => this.setState({ error: null })}
            style={{ paddingVertical: 12, paddingHorizontal: 24, backgroundColor: '#b8553a', borderRadius: 8 }}
          >
            <Text style={{ color: '#fff8f2', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

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
  const { playerOpen, setPlayerOpen, queueOpen, setQueueOpen, hydrate, token, setProfiles, setActiveProfile } = useStore();

  const [fontsLoaded] = useFonts({
    Geist: Geist_400Regular,
    GeistMedium: Geist_500Medium,
    GeistSemiBold: Geist_600SemiBold,
    GeistMono: GeistMono_400Regular,
    InstrumentSerif: InstrumentSerif_400Regular,
  });

  useEffect(() => {
    hydrate();
    setupAudio();
  }, []);

  useEffect(() => {
    if (!token) return;
    getProfiles().then((ps) => {
      setProfiles(ps);
      const cur = useStore.getState().activeProfileId;
      if (ps.length > 0 && (!cur || !ps.find((p) => p.id === cur))) {
        setActiveProfile(ps[0].id);
      }
    }).catch(() => {});
  }, [token]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <View style={{ flex: 1, backgroundColor: theme.bg }}>
            <AuthGuard>
              <Stack screenOptions={{ headerShown: false }} />
            </AuthGuard>

            {playerOpen && (
              <FullPlayer onClose={() => setPlayerOpen(false)} />
            )}
            {queueOpen && (
              <QueueSheet onClose={() => setQueueOpen(false)} />
            )}
          </View>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
