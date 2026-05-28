import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/shared/Icon';
import { useTheme } from '../hooks/useTheme';
import { useStore } from '../lib/store';
import { font, radius } from '../lib/tokens';
import {
  getNotifications,
  getNotificationCount,
  dismissNotification,
  dismissAllNotifications,
  reviewDownload,
} from '../lib/api';

const TYPE_LABEL: Record<string, string> = {
  quality_check: 'Verify song',
  upgrade_ready: 'Quality upgrade',
  exhausted: 'Download failed',
};

function scoreColor(score: number | null | undefined): string {
  if (score == null) return '#888';
  if (score >= 75) return '#4caf50';
  if (score >= 55) return '#ff9800';
  return '#f44336';
}

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setNotificationCount } = useStore();

  const [notifs, setNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [dismissingAll, setDismissingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getNotifications();
      setNotifs(data);
      // Update badge in store
      const countData = await getNotificationCount();
      setNotificationCount(countData.count);
    } catch (e: any) {
      Alert.alert('Load error', e.message ?? String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setNotificationCount]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDismiss = async (id: string) => {
    setActioning(id);
    try {
      await dismissNotification(id);
      setNotifs(n => n.filter(x => x.id !== id));
      setNotificationCount(Math.max(0, notifs.length - 1));
    } catch (e: any) {
      Alert.alert('Dismiss failed', e.message ?? String(e));
    } finally {
      setActioning(null);
    }
  };

  const handleDismissAll = async () => {
    setDismissingAll(true);
    try {
      await dismissAllNotifications();
      setNotifs([]);
      setNotificationCount(0);
    } catch (e: any) {
      Alert.alert('Dismiss all failed', e.message ?? String(e));
    } finally {
      setDismissingAll(false);
    }
  };

  const handleReview = async (notif: any, action: 'confirm' | 'wrong_song' | 'bad_quality') => {
    if (!notif.download_job_id) return;
    setActioning(notif.id);
    try {
      await reviewDownload(notif.download_job_id, action);
      await dismissNotification(notif.id);
      setNotifs(n => n.filter(x => x.id !== notif.id));
      setNotificationCount(Math.max(0, notifs.length - 1));
    } catch (e: any) {
      Alert.alert('Review failed', e.message ?? String(e));
    } finally {
      setActioning(null);
    }
  };

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
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />
      }
    >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
        </TouchableOpacity>
        <Text style={[styles.heading, { color: theme.fgStrong }]}>Notifications</Text>
        {notifs.length > 0 && (
          <TouchableOpacity
            onPress={handleDismissAll}
            disabled={dismissingAll}
            style={[styles.dismissAllBtn, { backgroundColor: theme.bgElev }]}
          >
            {dismissingAll
              ? <ActivityIndicator size="small" color={theme.fgMuted} />
              : <Text style={[styles.dismissAllText, { color: theme.fgMuted }]}>Dismiss all</Text>
            }
          </TouchableOpacity>
        )}
      </View>

      {notifs.length === 0 && (
        <Text style={[styles.empty, { color: theme.fgMuted }]}>No notifications.</Text>
      )}

      {notifs.length > 0 && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
          {notifs.map((notif, i) => (
            <NotifCard
              key={notif.id}
              notif={notif}
              last={i === notifs.length - 1}
              actioning={actioning === notif.id}
              onDismiss={() => handleDismiss(notif.id)}
              onReview={(action) => handleReview(notif, action)}
              theme={theme}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function NotifCard({
  notif, last, actioning, onDismiss, onReview, theme,
}: {
  notif: any; last: boolean; actioning: boolean;
  onDismiss: () => void;
  onReview: (action: 'confirm' | 'wrong_song' | 'bad_quality') => void;
  theme: any;
}) {
  const typeLabel = TYPE_LABEL[notif.type] ?? notif.type;
  const isQuality = notif.type === 'quality_check' || notif.type === 'upgrade_ready';
  const isExhausted = notif.type === 'exhausted';

  return (
    <View style={[
      styles.notifCard,
      !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft },
    ]}>
      <View style={styles.notifHeader}>
        <View style={[styles.typeBadge, {
          backgroundColor: isExhausted ? '#f4433620' : isQuality ? '#ff980020' : theme.bgElev
        }]}>
          <Text style={[styles.typeBadgeText, {
            color: isExhausted ? '#f44336' : isQuality ? '#ff9800' : theme.fgMuted,
            fontFamily: font.mono,
          }]}>
            {typeLabel.toUpperCase()}
          </Text>
        </View>
        <Text style={[styles.notifTime, { color: theme.fgMuted, fontFamily: font.mono }]}>
          {new Date(notif.created_at).toLocaleDateString()}
        </Text>
      </View>

      <Text style={[styles.notifMessage, { color: theme.fgStrong }]}>
        {notif.message}
      </Text>

      {actioning ? (
        <ActivityIndicator size="small" color={theme.accent} style={{ marginTop: 12, marginBottom: 4 }} />
      ) : (
        <>
          {isQuality && notif.download_job_id && (
            <View style={styles.reviewBtns}>
              <TouchableOpacity
                onPress={() => onReview('wrong_song')}
                style={[styles.reviewBtn, { backgroundColor: '#f4433618' }]}
              >
                <Text style={[styles.reviewBtnText, { color: '#f44336' }]}>Wrong Song</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onReview('bad_quality')}
                style={[styles.reviewBtn, { backgroundColor: '#ff980018' }]}
              >
                <Text style={[styles.reviewBtnText, { color: '#ff9800' }]}>Bad Quality</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onReview('confirm')}
                style={[styles.reviewBtn, { backgroundColor: '#4caf5018' }]}
              >
                <Text style={[styles.reviewBtnText, { color: '#4caf50' }]}>Sounds Good</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity onPress={onDismiss} style={styles.dismissBtn}>
            <Text style={[styles.dismissText, { color: theme.fgSoft }]}>Dismiss</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
    gap: 12, paddingBottom: 24,
  },
  back: { fontSize: 24 },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.02, flex: 1 },
  dismissAllBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  dismissAllText: { fontSize: 13 },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 60 },
  card: { marginHorizontal: 20, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  notifCard: { padding: 16 },
  notifHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  typeBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  typeBadgeText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.1 },
  notifTime: { fontSize: 11 },
  notifMessage: { fontSize: 14, lineHeight: 20 },
  reviewBtns: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  reviewBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  reviewBtnText: { fontSize: 13, fontWeight: '600' },
  dismissBtn: { marginTop: 10 },
  dismissText: { fontSize: 13 },
});
