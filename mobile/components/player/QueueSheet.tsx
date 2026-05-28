import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  SectionList,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks/useTheme';
import { useStore, Song } from '../../lib/store';
import { removeFromExplicitQueue, moveInExplicitQueue } from '../../lib/audio';
import { getCoverUrl } from '../../lib/api';
import { CoverArt } from '../shared/CoverArt';
import { Icon } from '../shared/Icon';
import { font, radius } from '../../lib/tokens';

const { height: SH } = Dimensions.get('window');

interface Props {
  onClose: () => void;
}

export function QueueSheet({ onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { explicitQueue, autoQueue, addShortBan, setAutoQueue } = useStore();
  const [localQueue, setLocalQueue] = useState<Song[]>(explicitQueue);

  useEffect(() => {
    setLocalQueue(explicitQueue);
  }, [explicitQueue]);

  const translateY = useSharedValue(SH);

  useEffect(() => {
    translateY.value = withSpring(0, { damping: 26, stiffness: 220 });
  }, []);

  const handleClose = () => {
    translateY.value = withSpring(SH, { damping: 26, stiffness: 220 }, () => {
      runOnJS(onClose)();
    });
  };

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handleRemoveAutoSong = async (song: Song, idx: number) => {
    // Add short ban so it won't appear again for 30 min
    addShortBan(song.id);
    // Remove from autoQueue store
    setAutoQueue(autoQueue.filter((_, i) => i !== idx));
    // Remove from RNTP (auto songs are after explicit queue)
    const { queueIndex, explicitQueue: eq } = useStore.getState();
    const rnptIdx = queueIndex + 1 + eq.length + idx;
    try {
      const { default: TrackPlayer } = await import('react-native-track-player');
      await TrackPlayer.remove([rnptIdx]);
    } catch {}
  };

  const renderExplicitItem = ({ item, drag, isActive, getIndex }: RenderItemParams<Song>) => {
    const idx = getIndex() ?? 0;
    return (
      <ScaleDecorator>
        <View
          style={[
            styles.row,
            {
              backgroundColor: isActive ? theme.bgElev : theme.bg,
              borderBottomColor: theme.borderSoft,
            },
          ]}
        >
          <Pressable onLongPress={drag} hitSlop={8} style={styles.dragHandle}>
            <Icon name="list" color={theme.fgSoft} size={18} strokeWidth={1.4} />
          </Pressable>

          <CoverArt
            uri={item.navidrome_id ? getCoverUrl(item.navidrome_id) : null}
            size={40}
            title={item.title}
          />

          <View style={styles.info}>
            <Text style={[styles.songTitle, { color: theme.fgStrong }]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
              {item.artist}
            </Text>
          </View>

          <Pressable
            onPress={() => removeFromExplicitQueue(idx)}
            hitSlop={10}
            style={styles.removeBtn}
          >
            <Icon name="close" color={theme.fgSoft} size={16} />
          </Pressable>
        </View>
      </ScaleDecorator>
    );
  };

  const totalCount = explicitQueue.length + autoQueue.length;

  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 70 }]}>
      {/* Backdrop */}
      <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
      </Pressable>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.bg,
            paddingBottom: insets.bottom,
          },
          animStyle,
        ]}
      >
        {/* Handle bar */}
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
        </View>

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.borderSoft }]}>
          <Text style={[styles.title, { color: theme.fgStrong }]}>
            Queue
            <Text style={[styles.count, { color: theme.fgMuted }]}>
              {'  '}{totalCount} songs
            </Text>
          </Text>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.closeBtn}>
            <Icon name="close" color={theme.fgStrong} size={20} />
          </Pressable>
        </View>

        {/* Explicit queue (draggable) */}
        {explicitQueue.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { borderBottomColor: theme.borderSoft }]}>
              <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
                UP NEXT
              </Text>
            </View>
            <DraggableFlatList
              data={localQueue}
              onDragEnd={({ data, from, to }) => {
                setLocalQueue(data);
                moveInExplicitQueue(from, to);
              }}
              keyExtractor={(item) => item.id}
              renderItem={renderExplicitItem}
              style={{ flexShrink: 1, maxHeight: SH * 0.35 }}
              contentContainerStyle={{ paddingBottom: 4 }}
            />
          </>
        )}

        {/* Auto-queue section */}
        {autoQueue.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { borderBottomColor: theme.borderSoft }]}>
              <Text style={[styles.sectionLabel, { color: theme.fgMuted, fontFamily: font.mono }]}>
                AUTO
              </Text>
              <Text style={[styles.sectionSub, { color: theme.fgSoft }]}>
                acoustically similar
              </Text>
            </View>
            {autoQueue.map((song, idx) => (
              <View
                key={song.id}
                style={[styles.row, styles.autoRow, { borderBottomColor: theme.borderSoft, backgroundColor: theme.bg }]}
              >
                <View style={styles.autoIndicator}>
                  <Icon name="sparkle" color={theme.accent} size={14} strokeWidth={1.5} />
                </View>

                <CoverArt
                  uri={song.navidrome_id ? getCoverUrl(song.navidrome_id) : null}
                  size={40}
                  title={song.title}
                />

                <View style={styles.info}>
                  <Text style={[styles.songTitle, { color: theme.fgStrong }]} numberOfLines={1}>
                    {song.title}
                  </Text>
                  <Text style={[styles.artist, { color: theme.fgMuted }]} numberOfLines={1}>
                    {song.artist}
                  </Text>
                </View>

                <Pressable
                  onPress={() => handleRemoveAutoSong(song, idx)}
                  hitSlop={10}
                  style={styles.removeBtn}
                >
                  <Icon name="close" color={theme.fgSoft} size={16} />
                </Pressable>
              </View>
            ))}
          </>
        )}

        {totalCount === 0 && (
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.fgMuted }]}>
              Queue is empty. Swipe songs to add them.
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SH * 0.82,
    borderTopLeftRadius: radius.petal,
    borderTopRightRadius: radius.petal,
    overflow: 'hidden',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.01,
  },
  count: {
    fontSize: 13,
    fontWeight: '400',
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 0.12,
    fontWeight: '600',
  },
  sectionSub: {
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingRight: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  autoRow: {
    opacity: 0.85,
  },
  dragHandle: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoIndicator: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  songTitle: {
    fontSize: 14.5,
    fontWeight: '500',
    lineHeight: 20,
  },
  artist: {
    fontSize: 12.5,
    marginTop: 1,
    lineHeight: 17,
  },
  removeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
