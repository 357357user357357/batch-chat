import { useState, type ReactNode } from "react";
import {
    Animated,
    Pressable,
    type GestureResponderEvent,
    type StyleProp,
    type ViewStyle,
} from "react-native";

export type AnimatedPressableProps = {
  onPress?: (event: GestureResponderEvent) => void;
  onPressIn?: (event: GestureResponderEvent) => void;
  onPressOut?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/** A `Pressable` that springs down slightly on press, like the tab bar icons. */
export function AnimatedPressable({
  style,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: AnimatedPressableProps) {
  const [scale] = useState(() => new Animated.Value(1));

  const animateTo = (toValue: number) =>
    Animated.spring(scale, {
      toValue,
      friction: 6,
      tension: 140,
      useNativeDriver: true,
    }).start();

  return (
    <Pressable
      onPressIn={(e) => {
        animateTo(0.94);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        animateTo(1);
        onPressOut?.(e);
      }}
      style={style}
      {...rest}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
