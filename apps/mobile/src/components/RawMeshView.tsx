import { useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

interface RawMeshViewProps {
  fallbackImageUri?: string;
  label?: string;
  modelUrl: string;
  onError?: (message: string) => void;
  onReady?: () => void;
}

/**
 * Native-safe raw mesh preview. Native does not ship a WebGL GLB renderer, so
 * it shows the provider mesh's generated front still instead. The web build
 * resolves RawMeshView.web.tsx and supplies the interactive viewer.
 */
export function RawMeshView({
  fallbackImageUri,
  label = 'Generated raw 3D model',
  modelUrl,
  onReady,
}: RawMeshViewProps) {
  const onReadyRef = useRef(onReady);
  const notifiedModelRef = useRef('');

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!fallbackImageUri) return;
    if (notifiedModelRef.current === modelUrl) return;
    notifiedModelRef.current = modelUrl;
    onReadyRef.current?.();
  }, [fallbackImageUri, modelUrl]);

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.liveMark}>
          <View style={styles.fallbackDot} />
          <Text style={styles.liveText}>3D MODEL · STILL VIEW</Text>
        </View>
        <Text style={styles.hint}>WEB: DRAG TO ROTATE</Text>
      </View>
      {fallbackImageUri ? (
        <Image
          accessibilityLabel={`${label}, front view`}
          resizeMode="contain"
          source={{ uri: fallbackImageUri }}
          style={styles.fallback}
        />
      ) : (
        <View accessibilityLabel={label} accessibilityRole="image" style={styles.empty}>
          <Text style={styles.emptyTitle}>3D model generated</Text>
          <Text style={styles.emptyText}>Use PixBrik on the web to rotate this GLB interactively.</Text>
        </View>
      )}
    </View>
  );
}

export const isInteractiveRawMeshViewSupported = false;

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#10131D',
    borderColor: '#384158',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: '#282E40',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  liveMark: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  fallbackDot: {
    backgroundColor: '#FFC400',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  liveText: {
    color: '#F6F7FB',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.15,
  },
  hint: {
    color: '#9EA7BC',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  fallback: {
    aspectRatio: 1.15,
    backgroundColor: '#17130A',
    width: '100%',
  },
  empty: {
    alignItems: 'center',
    aspectRatio: 1.15,
    justifyContent: 'center',
    padding: 24,
    width: '100%',
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  emptyText: {
    color: '#AEB6C9',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 7,
    maxWidth: 260,
    textAlign: 'center',
  },
});
