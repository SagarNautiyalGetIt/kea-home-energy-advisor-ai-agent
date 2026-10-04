import { Canvas as NativeCanvas } from '@react-three/fiber/native';
import { useState, type ComponentProps } from 'react';
import { PixelRatio, View } from 'react-native';
import { homeRenderSurface } from '@/lib/home-render-budget';

export { useLoader, useThree } from '@react-three/fiber/native';

// Fiber native always uses PixelRatio.get(), regardless of its web dpr prop.
// Render a smaller physical GL view and scale its visual box to the full scene.
// Orbit gestures remain on the full-sized InteractiveHomeScene parent.
export function Canvas({ style, onLayout, dpr, ...props }: ComponentProps<typeof NativeCanvas> & { dpr?: number }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const surface = homeRenderSurface(size.width, size.height, PixelRatio.get(), dpr);
  return <View style={[style, { overflow: 'hidden' }]} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setSize(current => current.width === width && current.height === height ? current : { width, height });
    onLayout?.(event);
  }}>
    {surface && <NativeCanvas {...props} style={{ position: 'absolute', width: surface.width, height: surface.height,
      left: (size.width - surface.width) / 2, top: (size.height - surface.height) / 2,
      transform: [{ scaleX: surface.scaleX }, { scaleY: surface.scaleY }] }} />}
  </View>;
}
