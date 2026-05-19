import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../hooks/useTheme';
import { useStore, Profile } from '../../lib/store';
import { radius } from '../../lib/tokens';

const { width: SW, height: SH } = Dimensions.get('window');
const RADIUS = 122;
const PETAL_W = 112;
const PETAL_H = 72;

function petalPosition(index: number, total: number) {
  const startAngle = -Math.PI * 0.85;
  const endAngle = -Math.PI * 0.15;
  const angle = total === 1 ? -Math.PI / 2 : startAngle + (index / (total - 1)) * (endAngle - startAngle);
  return {
    x: RADIUS * Math.cos(angle) - PETAL_W / 2,
    y: RADIUS * Math.sin(angle) - PETAL_H / 2,
  };
}

interface Props {
  anchorX: number;
  anchorY: number;
  onSelect: (profile: Profile) => void;
  onDismiss: () => void;
}

export function RadialSwitcher({ anchorX, anchorY, onSelect, onDismiss }: Props) {
  const theme = useTheme();
  const { profiles, activeProfileId } = useStore();
  const [focused, setFocused] = useState<string | null>(null);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    opacity.value = withTiming(1, { duration: 180 });
  }, []);

  const dismiss = () => {
    opacity.value = withTiming(0, { duration: 140 }, () => runOnJS(onDismiss)());
  };

  const bgStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, { zIndex: 100 }, bgStyle]}>
      {/* Blur backdrop tap to dismiss */}
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={dismiss} activeOpacity={1}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.bg + 'b3' }]} />
      </TouchableOpacity>

      {profiles.map((profile, i) => {
        const pos = petalPosition(i, profiles.length);
        const isFocused = focused === profile.id;
        const isActive = activeProfileId === profile.id;

        return (
          <TouchableOpacity
            key={profile.id}
            onPress={() => { onSelect(profile); dismiss(); }}
            onPressIn={() => setFocused(profile.id)}
            onPressOut={() => setFocused(null)}
            style={[
              styles.petal,
              {
                left: anchorX + pos.x,
                top: anchorY + pos.y,
                backgroundColor: isFocused ? theme.accent : theme.surface,
                borderColor: isFocused ? theme.accent : (isActive ? theme.accentTint : theme.border),
                transform: [{ scale: isFocused ? 1.08 : 1 }],
              },
            ]}
          >
            <Text style={{ fontSize: 20, lineHeight: 24 }}>{profile.glyph}</Text>
            <Text
              style={[
                styles.petalName,
                { color: isFocused ? theme.onAccent : theme.fgStrong },
              ]}
              numberOfLines={2}
            >
              {profile.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  petal: {
    position: 'absolute',
    width: PETAL_W,
    height: PETAL_H,
    borderRadius: radius.petal,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 4,
    shadowColor: '#28190f',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 6,
  },
  petalName: {
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 15,
  },
});
