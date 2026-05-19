import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { font, radius } from '../lib/tokens';
import { getDownloads, retryDownload, deleteDownload } from '../lib/api';

const STATUS_ORDER = ['queued', 'downloading', 'failed', 'exhausted', 'completed'];
const STATUS_LABEL: Record<string, string> = {
  queued: 'QUEUED',
  downloading: 'DOWNLOADING',
  failed: 'FAILED',
  exhausted: 'EXHAUSTED',
  completed: 'COMPLETED',
};

export default function DownloadsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await getDownloads(undefined, 1, 200);
      setJobs(all);
    } catch (e) {
      console.error('downloads load error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRetry = async (id: string) => {
    setRetrying(id);
    try {
      await retryDownload(id);
      await load();
    } finally {
      setRetrying(null);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDownload(id);
    setJobs(jobs.filter(j => j.id !== id));
  };

  const grouped = STATUS_ORDER.reduce((acc, status) => {
    const items = jobs.filter(j => j.status === status);
    if (items.length) acc[status] = items;
    return acc;
  }, {} as Record<string, any[]>);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
    >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: theme.fgStrong }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>Downloads</Text>
      </View>

      {jobs.length === 0 && (
        <Text style={[styles.empty, { color: theme.fgMuted }]}>No downloads yet.</Text>
      )}

      {STATUS_ORDER.filter(s => grouped[s]).map(status => (
        <View key={status} style={{ marginBottom: 24 }}>
          <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
            {STATUS_LABEL[status]} ({grouped[status].length})
          </Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
            {grouped[status].map((job, i) => (
              <JobRow
                key={job.id}
                job={job}
                last={i === grouped[status].length - 1}
                retrying={retrying === job.id}
                onRetry={() => handleRetry(job.id)}
                onDelete={() => handleDelete(job.id)}
                theme={theme}
              />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function JobRow({ job, last, retrying, onRetry, onDelete, theme }: {
  job: any; last: boolean; retrying: boolean;
  onRetry: () => void; onDelete: () => void; theme: any;
}) {
  const canRetry = job.status === 'failed' || job.status === 'exhausted';
  const canDelete = ['completed', 'failed', 'exhausted'].includes(job.status);

  const sourceSummary = job.sources_tried?.length
    ? job.sources_tried.map((s: any) => `${s.source}: ${s.error}`).join(' · ')
    : null;

  return (
    <View style={[
      styles.jobRow,
      !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft },
    ]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.jobTitle, { color: theme.fgStrong }]} numberOfLines={1}>
          {job.artist} — {job.title}
        </Text>
        {job.item_type !== 'track' && (
          <Text style={[styles.jobMeta, { color: theme.fgMuted }]}>{job.item_type}</Text>
        )}
        {sourceSummary && (
          <Text style={[styles.jobError, { color: theme.fgSoft }]} numberOfLines={2}>
            {sourceSummary}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        {canRetry && (
          <TouchableOpacity
            onPress={onRetry}
            disabled={retrying}
            style={[styles.actionBtn, { backgroundColor: theme.accentBg }]}
          >
            {retrying
              ? <ActivityIndicator size="small" color={theme.accent} />
              : <Text style={[styles.actionText, { color: theme.accent }]}>Retry</Text>
            }
          </TouchableOpacity>
        )}
        {canDelete && (
          <TouchableOpacity onPress={onDelete} style={[styles.actionBtn, { backgroundColor: theme.bgElev }]}>
            <Text style={[styles.actionText, { color: theme.fgMuted }]}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 16, paddingBottom: 24 },
  back: { fontSize: 24 },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.02 },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 60 },
  sectionLabel: { fontSize: 10.5, letterSpacing: 0.12, fontWeight: '500', paddingHorizontal: 20, marginBottom: 8 },
  card: { marginHorizontal: 20, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  jobRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  jobTitle: { fontSize: 14, fontWeight: '500' },
  jobMeta: { fontSize: 12, marginTop: 2 },
  jobError: { fontSize: 11, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  actionText: { fontSize: 13, fontWeight: '500' },
});
