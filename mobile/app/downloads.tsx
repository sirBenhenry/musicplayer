import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,

  View,
  Pressable,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/shared/Icon';
import { useTheme } from '../hooks/useTheme';
import { font, radius } from '../lib/tokens';
import { getDownloads, retryDownload, cancelDownload, deleteDownload, getDownloadPipeline, reviewDownload } from '../lib/api';

const STATUS_ORDER = ['downloading', 'failed', 'exhausted', 'queued', 'pending_review', 'bad_quality', 'completed'];
const STATUS_LABEL: Record<string, string> = {
  queued: 'QUEUED',
  downloading: 'DOWNLOADING',
  pending_review: 'NEEDS REVIEW',
  bad_quality: 'BAD QUALITY',
  failed: 'FAILED',
  exhausted: 'EXHAUSTED',
  completed: 'COMPLETED',
};

function scoreColor(score: number, theme: any): string {
  if (score >= 75) return '#4caf50';
  if (score >= 55) return '#ff9800';
  return '#f44336';
}

export default function DownloadsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pipelineData, setPipelineData] = useState<Record<string, any>>({});
  const [pipelineLoading, setPipelineLoading] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await getDownloads(undefined, 1, 2000);
      // Filter out auto-expired completed jobs
      const now = Date.now();
      const visible = all.filter((j: any) => {
        if (j.status === 'completed' && j.auto_expires_at) {
          return new Date(j.auto_expires_at).getTime() > now;
        }
        return true;
      });
      setJobs(visible);
    } catch (e: any) {
      Alert.alert('Load error', e.message ?? String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    // Auto-refresh every 5s while screen is focused (for active downloads)
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]));

  const handleRetry = async (id: string) => {
    setRetrying(id);
    try {
      await retryDownload(id);
      await load();
    } catch (e: any) {
      Alert.alert('Retry failed', e.message ?? String(e));
    } finally {
      setRetrying(null);
    }
  };

  const handleCancel = async (id: string) => {
    setCancelling(id);
    try {
      await cancelDownload(id);
      await load();
    } catch (e: any) {
      Alert.alert('Cancel failed', e.message ?? String(e));
    } finally {
      setCancelling(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDownload(id);
      setJobs(jobs.filter(j => j.id !== id));
    } catch (e: any) {
      Alert.alert('Delete failed', e.message ?? String(e));
    }
  };

  const handleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!pipelineData[id]) {
      setPipelineLoading(id);
      try {
        const data = await getDownloadPipeline(id);
        setPipelineData(prev => ({ ...prev, [id]: data }));
      } catch (e: any) {
        Alert.alert('Pipeline load error', e.message ?? String(e));
      } finally {
        setPipelineLoading(null);
      }
    }
  };

  const handleReview = async (id: string, action: 'confirm' | 'wrong_song' | 'bad_quality') => {
    setReviewing(id);
    try {
      await reviewDownload(id, action);
      await load();
      // Refresh pipeline data
      if (pipelineData[id]) {
        const data = await getDownloadPipeline(id);
        setPipelineData(prev => ({ ...prev, [id]: data }));
      }
    } catch (e: any) {
      Alert.alert('Review failed', e.message ?? String(e));
    } finally {
      setReviewing(null);
    }
  };

  // Group by effective status (use review_status as sub-category for completed jobs)
  const grouped = (() => {
    const groups: Record<string, any[]> = {};
    for (const job of jobs) {
      let key = job.status;
      if (job.status === 'completed' && job.review_status === 'pending_review') key = 'pending_review';
      else if (job.status === 'completed' && job.review_status === 'bad_quality') key = 'bad_quality';
      if (!groups[key]) groups[key] = [];
      groups[key].push(job);
    }
    return groups;
  })();

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
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={theme.accent}
        />
      }
    >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
        </Pressable>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>Pipeline Activity</Text>
      </View>

      {jobs.length === 0 && (
        <Text style={[styles.empty, { color: theme.fgMuted }]}>No active downloads.</Text>
      )}

      {STATUS_ORDER.filter(s => grouped[s]?.length).map(status => (
        <View key={status} style={{ marginBottom: 24 }}>
          <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
            {STATUS_LABEL[status]} ({grouped[status].length})
          </Text>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
            {grouped[status].map((job, i) => (
              <JobCard
                key={job.id}
                job={job}
                last={i === grouped[status].length - 1}
                retrying={retrying === job.id}
                cancelling={cancelling === job.id}
                reviewing={reviewing === job.id}
                isExpanded={expanded === job.id}
                pipelineData={pipelineData[job.id]}
                pipelineLoading={pipelineLoading === job.id}
                onRetry={() => handleRetry(job.id)}
                onCancel={() => handleCancel(job.id)}
                onDelete={() => handleDelete(job.id)}
                onExpand={() => handleExpand(job.id)}
                onReview={(action) => handleReview(job.id, action)}
                theme={theme}
              />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function JobCard({
  job, last, retrying, cancelling, reviewing, isExpanded, pipelineData, pipelineLoading,
  onRetry, onCancel, onDelete, onExpand, onReview, theme,
}: {
  job: any; last: boolean; retrying: boolean; cancelling: boolean; reviewing: boolean;
  isExpanded: boolean; pipelineData: any; pipelineLoading: boolean;
  onRetry: () => void; onCancel: () => void; onDelete: () => void;
  onExpand: () => void;
  onReview: (action: 'confirm' | 'wrong_song' | 'bad_quality') => void;
  theme: any;
}) {
  const canCancel = job.status === 'queued' || job.status === 'downloading';
  const canRetry = job.status === 'failed' || job.status === 'exhausted';
  const canDelete = ['completed', 'failed', 'exhausted'].includes(job.status);
  const needsReview = job.review_status === 'pending_review' || job.review_status === 'bad_quality';
  const score = job.confidence_score;

  return (
    <View style={[
      styles.jobCard,
      !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft },
    ]}>
      {/* Main row */}
      <Pressable onPress={onExpand} style={styles.jobMain}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.jobTitle, { color: theme.fgStrong }]} numberOfLines={1}>
            {job.artist} — {job.title}
          </Text>
          <View style={styles.jobMeta}>
            {job.item_type !== 'track' && (
              <Text style={[styles.metaChip, { color: theme.fgMuted }]}>{job.item_type}</Text>
            )}
            {job.source_used && (
              <Text style={[styles.metaChip, { color: theme.fgSoft }]}>{job.source_used}</Text>
            )}
            {score != null && (
              <Text style={[styles.scoreChip, { color: scoreColor(score, theme), borderColor: scoreColor(score, theme) }]}>
                {score.toFixed(0)}/100
              </Text>
            )}
          </View>
        </View>
        <Text style={{ color: theme.fgSoft, fontSize: 16 }}>{isExpanded ? '▲' : '▼'}</Text>
      </Pressable>

      {/* Review actions */}
      {needsReview && !reviewing && (
        <View style={styles.reviewRow}>
          <Text style={[styles.reviewLabel, { color: theme.fgMuted }]}>
            {job.review_status === 'pending_review' ? 'Low confidence — verify this is correct:' : 'Poor quality — flag for upgrade or verify:'}
          </Text>
          <View style={styles.reviewBtns}>
            <Pressable
              onPress={() => onReview('wrong_song')}
              style={[styles.reviewBtn, { backgroundColor: '#f4433620' }]}
            >
              <Text style={[styles.reviewBtnText, { color: '#f44336' }]}>Wrong Song</Text>
            </Pressable>
            <Pressable
              onPress={() => onReview('bad_quality')}
              style={[styles.reviewBtn, { backgroundColor: '#ff980020' }]}
            >
              <Text style={[styles.reviewBtnText, { color: '#ff9800' }]}>Bad Quality</Text>
            </Pressable>
            <Pressable
              onPress={() => onReview('confirm')}
              style={[styles.reviewBtn, { backgroundColor: '#4caf5020' }]}
            >
              <Text style={[styles.reviewBtnText, { color: '#4caf50' }]}>Sounds Good</Text>
            </Pressable>
          </View>
        </View>
      )}
      {reviewing && (
        <View style={styles.reviewRow}>
          <ActivityIndicator size="small" color={theme.accent} />
        </View>
      )}

      {/* Standard actions */}
      <View style={styles.actions}>
        {canCancel && (
          <Pressable
            onPress={onCancel}
            disabled={cancelling}
            style={[styles.actionBtn, { backgroundColor: theme.bgElev, borderColor: theme.border, borderWidth: 1 }]}
          >
            {cancelling
              ? <ActivityIndicator size="small" color={theme.fgMuted} />
              : <Text style={[styles.actionText, { color: theme.fgMuted }]}>Cancel</Text>
            }
          </Pressable>
        )}
        {canRetry && (
          <Pressable
            onPress={onRetry}
            disabled={retrying}
            style={[styles.actionBtn, { backgroundColor: theme.accentBg }]}
          >
            {retrying
              ? <ActivityIndicator size="small" color={theme.accent} />
              : <Text style={[styles.actionText, { color: theme.accent }]}>Retry fresh</Text>
            }
          </Pressable>
        )}
        {canDelete && (
          <Pressable onPress={onDelete} style={[styles.actionBtn, { backgroundColor: theme.bgElev }]}>
            <Text style={[styles.actionText, { color: theme.fgMuted }]}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Pipeline detail */}
      {isExpanded && (
        <View style={[styles.pipelinePanel, { borderTopColor: theme.borderSoft }]}>
          {pipelineLoading && <ActivityIndicator size="small" color={theme.accent} style={{ margin: 12 }} />}

          {pipelineData && (
            <>
              {/* Pipeline log steps */}
              {(pipelineData.pipeline_log || []).length > 0 && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={[styles.panelLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>PIPELINE LOG</Text>
                  {(pipelineData.pipeline_log as any[]).map((step, i) => (
                    <View key={i} style={styles.logStep}>
                      <Text style={[styles.logBullet, { color: step.status === 'error' ? '#f44336' : step.status === 'warn' ? '#ff9800' : '#4caf50' }]}>
                        {step.status === 'error' ? '✗' : step.status === 'warn' ? '!' : '✓'}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.logStep_, { color: theme.fgStrong }]}>{step.step}</Text>
                        <Text style={[styles.logMsg, { color: theme.fgSoft }]}>{step.message}</Text>
                        <Text style={[styles.logTs, { color: theme.fgMuted, fontFamily: font.mono }]}>
                          {new Date(step.ts).toLocaleTimeString()}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Candidates */}
              {(pipelineData.candidates || []).length > 0 && (
                <View>
                  <Text style={[styles.panelLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
                    CANDIDATES ({pipelineData.candidates.length})
                  </Text>
                  {(pipelineData.candidates as any[]).slice(0, 10).map((c, i) => {
                    const total = c.scores?.total ?? 0;
                    return (
                      <View key={i} style={[styles.candidateRow, { borderBottomColor: theme.borderSoft }]}>
                        <View style={[styles.sourceTag, { backgroundColor: theme.bgElev }]}>
                          <Text style={[styles.sourceTagText, { color: theme.fgMuted, fontFamily: font.mono }]}>
                            {c.source}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.candTitle, { color: theme.fg }]} numberOfLines={1}>
                            {c.title}
                          </Text>
                          <Text style={[styles.candMeta, { color: theme.fgSoft }]}>
                            {c.format}{c.bitrate ? ` ${c.bitrate}kbps` : ''}{c.file_size ? ` · ${(c.file_size / 1e6).toFixed(1)}MB` : ''}
                          </Text>
                          {c.scores && (
                            <Text style={[styles.candScores, { color: theme.fgMuted, fontFamily: font.mono }]}>
                              id:{c.scores.identity?.toFixed(0)} q:{c.scores.quality?.toFixed(0)} src:{c.scores.source?.toFixed(0)} meta:{c.scores.metadata?.toFixed(0)}
                            </Text>
                          )}
                        </View>
                        <Text style={[styles.candTotal, { color: scoreColor(total, theme) }]}>
                          {total.toFixed(0)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>
      )}
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
  jobCard: { paddingHorizontal: 16, paddingTop: 12 },
  jobMain: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 8 },
  jobTitle: { fontSize: 14, fontWeight: '600' },
  jobMeta: { flexDirection: 'row', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  metaChip: { fontSize: 11 },
  scoreChip: { fontSize: 11, fontWeight: '700', borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  reviewRow: { paddingBottom: 10 },
  reviewLabel: { fontSize: 12, marginBottom: 8 },
  reviewBtns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  reviewBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  reviewBtnText: { fontSize: 12, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  actionText: { fontSize: 13, fontWeight: '500' },

  // Pipeline panel
  pipelinePanel: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, paddingBottom: 12 },
  panelLabel: { fontSize: 9.5, letterSpacing: 0.1, fontWeight: '600', marginBottom: 8 },
  logStep: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  logBullet: { fontSize: 13, fontWeight: '700', marginTop: 1 },
  logStep_: { fontSize: 12, fontWeight: '600' },
  logMsg: { fontSize: 11, marginTop: 1 },
  logTs: { fontSize: 10, marginTop: 1 },

  // Candidates
  candidateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sourceTag: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  sourceTagText: { fontSize: 10, fontWeight: '600' },
  candTitle: { fontSize: 12, fontWeight: '500' },
  candMeta: { fontSize: 11, marginTop: 1 },
  candScores: { fontSize: 10, marginTop: 2 },
  candTotal: { fontSize: 15, fontWeight: '700', minWidth: 30, textAlign: 'right' },
});
