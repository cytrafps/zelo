import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { View, type ViewProps } from 'react-native';

import { useTheme } from '@/theme';

/** iOS 26 et plus ; ailleurs, une surface opaque comme avant. */
const liquid = isLiquidGlassAvailable();

/**
 * Surface des commandes posées sur la carte : Liquid Glass sur iOS 26, carte blanche ailleurs.
 * Le verre laisse voir la carte dessous, comme les commandes de Plans.
 */
export function Glass({ style, interactive, ...props }: ViewProps & { interactive?: boolean }) {
  const { c } = useTheme();
  if (liquid) return <GlassView glassEffectStyle="regular" isInteractive={interactive} style={style} {...props} />;
  return <View style={[shadow, { backgroundColor: c.fond.surface }, style]} {...props} />;
}

// Le verre porte sa propre ombre ; la surface opaque garde celle des maquettes.
const shadow = { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 };
