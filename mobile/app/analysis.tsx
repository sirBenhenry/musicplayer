import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/shared/Icon';
import { useTheme } from '../hooks/useTheme';
import { font, radius } from '../lib/tokens';
import { getAnalysisStatus, retryFailedAnalysis } from '../lib/api';

type SongItem = { id: string; title: string; artist: string };

type Status = {
  total: number;
  completed: number;
  queued: number;
  failed: number;
  in_progress: number;
  songs_in_progress: SongItem[];
  songs_queued: SongItem[];
  songs_failed: SongItem[];
};

export default function AnalysisScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const s = await getAnalysisStatus();
      setStatus(s);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      pollRef.current = setInterval(() => load(true), 5000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }, [load])
  );

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const r = await retryFailedAnalysis();
      Alert.alert('Retrying', `Reset ${r.reset} failed song${r.reset !== 1 ? 's' : ''} — will be picked up in next batch`);
      await load();
    } catch {
      Alert.alert('Error', 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const s = theme;
  const pct = status ? Math.round((status.completed / Math.max(status.total, 1)) * 100) : 0;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: s.bg }]}>
        <ActivityIndicator color={s.accent} />
      </View>
    );
  }

  const renderSongRow = (item: SongItem, icon: 'refresh' | 'download' | 'trash', color: string) => (
    <View key={item.id} style={[styles.row, { borderBottomColor: s.border }]}>
      <Icon name={icon} size={14} color={color} />
      <View style={styles.rowText}>
        <Text style={[styles.title, { color: s.fg }]} numberOfLines={1}>{item.title || '—'}</Text>
        <Text style={[styles.artist, { color: s.fgSoft }]} numberOfLines={1}>{item.artist || '—'}</Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: s.bg }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} tintColor={s.accent} />}
      >
        {/* Header */}
        <Text style={[styles.heading, { color: s.fg }]}>Audio Analysis</Text>

        {/* Progress card */}
        {status && (
          <View style={[styles.card, { backgroundColor: s.surface, borderColor: s.border }]}>
            <View style={styles.cardRow}>
              <Text style={[styles.cardLabel, { color: s.fgSoft }]}>Vectors computed</Text>
              <Text style={[styles.cardValue, { color: s.fg }]}>{status.completed} / {status.total}</Text>
            </View>

            {/* Progress bar */}
            <View style={[styles.barBg, { backgroundColor: s.border }]}>
              <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: s.accent }]} />
            </View>
            <Text style={[styles.pct, { color: s.accent }]}>{pct}%</Text>

            <View style={styles.pills}>
              <View style={[styles.pill, { backgroundColor: s.border }]}>
                <Text style={[styles.pillText, { color: s.fgSoft }]}>
                  {status.in_progress} processing
                </Text>
              </View>
              <View style={[styles.pill, { backgroundColor: s.border }]}>
                <Text style={[styles.pillText, { color: s.fgSoft }]}>
                  {status.queued} queued
                </Text>
              </View>
              {status.failed > 0 && (
                <View style={[styles.pill, { backgroundColor: '#f4433620' }]}>
                  <Text style={[styles.pillText, { color: '#f44336' }]}>
                    {status.failed} failed
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Retry failed button */}
        {status && status.failed > 0 && (
          <Pressable
            style={({ pressed }) => [styles.retryBtn, { backgroundColor: pressed ? '#f4433630' : '#f4433618', borderColor: '#f44336' }]}
            onPress={handleRetry}
            disabled={retrying}
          >
            {retrying
              ? <ActivityIndicator size="small" color="#f44336" />
              : <Text style={[styles.retryBtnText, { color: '#f44336' }]}>Retry {status.failed} Failed Songs</Text>
            }
          </Pressable>
        )}

        {/* In progress */}
        {status && status.songs_in_progress.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: s.fgSoft }]}>Currently Processing</Text>
            {status.songs_in_progress.map(item => renderSongRow(item, 'refresh', s.accent))}
          </View>
        )}

        {/* Failed */}
        {status && status.songs_failed.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: '#f44336' }]}>Failed (no vector)</Text>
            {status.songs_failed.map(item => renderSongRow(item, 'trash', '#f44336'))}
            {status.failed > 100 && (
              <Text style={[styles.more, { color: s.fgSoft }]}>+{status.failed - 100} more</Text>
            )}
          </View>
        )}

        {/* Queued */}
        {status && status.songs_queued.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: s.fgSoft }]}>Queued</Text>
            {status.songs_queued.map(item => renderSongRow(item, 'download', s.fgSoft))}
            {status.queued > 100 && (
              <Text style={[styles.more, { color: s.fgSoft }]}>+{status.queued - 100} more</Text>
            )}
          </View>
        )}

        {status && status.completed === status.total && status.total > 0 && (
          <View style={styles.section}>
            <Text style={[styles.doneText, { color: s.accent }]}>All songs analysed ✓</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingHorizontal: 16, gap: 12 },
  heading: { fontFamily: font.ui, fontSize: 24, fontWeight: '700', marginBottom: 4 },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontFamily: font.ui, fontSize: 13 },
  cardValue: { fontFamily: font.mono, fontSize: 15, fontWeight: '600' },
  barBg: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  pct: { fontFamily: font.mono, fontSize: 12, textAlign: 'right' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  pill: { borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontFamily: font.mono, fontSize: 11 },
  retryBtn: {
    borderRadius: radius.card,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  retryBtnText: { fontFamily: font.ui, fontSize: 14, fontWeight: '600' },
  section: { gap: 2, marginTop: 8 },
  sectionLabel: { fontFamily: font.mono, fontSize: 11, letterSpacing: 0.5, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  title: { fontFamily: font.ui, fontSize: 14, fontWeight: '500' },
  artist: { fontFamily: font.ui, fontSize: 12, marginTop: 1 },
  more: { fontFamily: font.mono, fontSize: 11, textAlign: 'center', marginTop: 8 },
  doneText: { fontFamily: font.ui, fontSize: 16, fontWeight: '600', textAlign: 'center', paddingVertical: 16 },
});
