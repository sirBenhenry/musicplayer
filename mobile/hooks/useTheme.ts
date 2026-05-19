import { useStore } from '../lib/store';
import { getTheme } from '../lib/tokens';

export function useTheme() {
  const { isDark, isSage } = useStore();
  return getTheme(isDark, isSage);
}
