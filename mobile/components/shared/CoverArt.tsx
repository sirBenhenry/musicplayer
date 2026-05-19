import React from 'react';
import { Image, View, StyleSheet, Text } from 'react-native';
import { useTheme } from '../../hooks/useTheme';
import { radius } from '../../lib/tokens';

interface Props {
  uri?: string | null;
  size: number;
  title?: string;
  borderRadius?: number;
  style?: object;
}

export function CoverArt({ uri, size, title, borderRadius = radius.cover, style }: Props) {
  const theme = useTheme();
  const initials = title
    ? title.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
    : '?';

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: theme.surface,
          borderColor: theme.borderSoft,
        },
        style,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius }}
          resizeMode="cover"
        />
      ) : (
        <Text style={[styles.initials, { color: theme.fgSoft, fontSize: size * 0.3 }]}>
          {initials}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 0.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontWeight: '600',
  },
});
