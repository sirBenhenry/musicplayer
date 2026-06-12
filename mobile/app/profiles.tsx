import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/shared/Icon';
import { TextInputModal } from '../components/shared/TextInputModal';
import { useTheme } from '../hooks/useTheme';
import { font, radius } from '../lib/tokens';
import { getProfiles, createProfile, updateProfile, deleteProfile } from '../lib/api';
// daily_auto_generate no longer shown — all profiles get daily playlists; nightly job only regenerates consumed ones

export default function ProfilesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [renameTarget, setRenameTarget] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await getProfiles();
      setProfiles(data);
    } catch {}
    setLoading(false);
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, []));

  const handleRename = async (newName: string) => {
    if (!renameTarget) return;
    const target = renameTarget;
    setRenameTarget(null);
    setSaving(target.id);
    try {
      await updateProfile(target.id, {
        name: newName,
        description: target.description ?? null,
        glyph: target.glyph ?? null,
        hue: target.hue ?? null,
        is_catchall: target.is_catchall,
        daily_auto_generate: true,
      });
      setProfiles(ps => ps.map(p => p.id === target.id ? { ...p, name: newName } : p));
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(null);
    }
  };

  const handleCreate = async (name: string) => {
    setCreating(false);
    setSaving('new');
    try {
      const p = await createProfile({ name: name.trim(), daily_auto_generate: true });
      setProfiles(ps => [...ps, p]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = (profile: any) => {
    Alert.alert(
      `Delete "${profile.name}"?`,
      `${profile.song_count} song${profile.song_count !== 1 ? 's' : ''} will become unassigned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setSaving(profile.id);
            try {
              await deleteProfile(profile.id);
              setProfiles(ps => ps.filter(p => p.id !== profile.id));
            } catch (e: any) {
              Alert.alert('Error', e.message ?? String(e));
            } finally {
              setSaving(null);
            }
          },
        },
      ],
    );
  };

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Icon name="arrowLeft" color={theme.fgStrong} size={22} />
          </Pressable>
          <Text style={[styles.heading, { color: theme.fgStrong }]}>Profiles</Text>
          <Pressable onPress={() => setCreating(true)} hitSlop={12}>
            {saving === 'new'
              ? <ActivityIndicator size="small" color={theme.accent} />
              : <Icon name="plus" color={theme.accent} size={22} />}
          </Pressable>
        </View>

        {loading ? (
          <View style={{ paddingTop: 60, alignItems: 'center' }}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.borderSoft }]}>
            {profiles.map((profile, i) => {
              const isLast = i === profiles.length - 1;
              const isSaving = saving === profile.id;

              return (
                <View
                  key={profile.id}
                  style={[
                    styles.profileRow,
                    !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.borderSoft },
                  ]}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      {profile.glyph ? (
                        <Text style={{ fontSize: 15 }}>{profile.glyph}</Text>
                      ) : null}
                      <Text style={{ color: theme.fgStrong, fontSize: 16, fontWeight: '500' }}>
                        {profile.name}
                      </Text>
                      {profile.is_catchall && (
                        <View style={[styles.chip, { backgroundColor: theme.accentBg }]}>
                          <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>ALL</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: theme.fgMuted, fontSize: 12, fontFamily: font.mono }}>
                      {profile.song_count} songs
                    </Text>
                  </View>

                  {!profile.is_catchall && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      {isSaving ? (
                        <ActivityIndicator size="small" color={theme.accent} style={{ marginRight: 4 }} />
                      ) : (
                        <>
                          <Pressable
                            onPress={() => setRenameTarget(profile)}
                            hitSlop={10}
                            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
                          >
                            <Icon name="dots" color={theme.fgSoft} size={18} />
                          </Pressable>
                          <Pressable
                            onPress={() => handleDelete(profile)}
                            hitSlop={10}
                            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
                          >
                            <Icon name="trash" color={theme.fgSoft} size={18} />
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <TextInputModal
        visible={!!renameTarget}
        title={renameTarget ? `Rename "${renameTarget.name}"` : 'Rename'}
        placeholder="Profile name"
        defaultValue={renameTarget?.name ?? ''}
        onConfirm={handleRename}
        onCancel={() => setRenameTarget(null)}
      />
      <TextInputModal
        visible={creating}
        title="New Profile"
        placeholder="Profile name"
        onConfirm={handleCreate}
        onCancel={() => setCreating(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.02 },
  card: { marginHorizontal: 20, borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  profileRow: { paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center' },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  iconBtn: { padding: 8 },
});
