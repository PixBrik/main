import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { G, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { voxelize, type VoxelZone } from '../lib/voxelFox';
import { buildRenderFaces, type Projection, type RenderFace } from '../lib/voxelRender';
import { colors, fonts, inkAlpha, saffronAlpha } from '../theme/tokens';

interface ObjectSculptureProps {
  scanLines?: boolean;
}

/**
 * Pre-scan placeholder: the product promise in one picture — your photo,
 * the scan, and the brick-built result. The sneaker is a GENERIC red/white/
 * black high-top (deliberately no third-party branding or trade dress), and
 * the brick version on the right is genuinely produced by the same voxel
 * engine that builds real photos, not an illustration of one.
 */

/**
 * Side profile along +x = toe. The high-top "L" silhouette that reads as a
 * shoe: a FLAT low vamp, a STEEP near-vertical collar rise at the back, and
 * a rounded toe dome — not a continuous diagonal (which reads as a wedge).
 */
function topProfile(x: number): number {
  if (x > 1.35) {
    const t = (x - 1.35) / 1.0;
    return Math.max(0.5, 1.0 - t * t * 0.55); // toe dome
  }
  if (x > -0.2) return 1.0; // flat vamp
  if (x > -0.55) return 1.0 + ((-0.2 - x) / 0.35) * 1.5; // steep collar rise
  return 2.5; // collar
}

function halfWidth(x: number): number {
  if (x > 1.6) return 0.58;
  if (x < -1.6) return 0.66;
  return 0.75;
}

function classifySneaker(x: number, y: number, z: number): VoxelZone | null {
  if (x < -2.0 || x > 2.2 || y < 0) return null;
  if (Math.abs(z) > halfWidth(x)) return null;
  const top = topProfile(x);

  // Tongue: raised pad peeking above the vamp, in front of the collar.
  const onTongue = x > -0.15 && x < 0.45 && Math.abs(z) < 0.32 && y <= 1.5;
  if (y > top && !onTongue) return null;

  // Ankle opening (hollow) behind the tongue.
  if (x < -0.55 && x > -1.9 && y > top - 0.3 && Math.abs(z) < 0.34) return null;

  if (y < 0.14) return 'dark'; // outsole
  if (y < 0.45) return 'cream'; // midsole
  if (x > 1.15 && y < 1.0) return 'cream'; // toe cap
  if (x < -1.55 && y < 1.3) return 'cream'; // heel patch
  if (onTongue && y > top) return y > 1.32 ? 'dark' : 'accent'; // tongue + dark tip
  if (y > top - 0.3 && x < -0.55) return 'dark'; // collar rim
  // Lace bars across the flat vamp top.
  if (x > 0.3 && x < 1.15 && y > 0.8 && Math.abs(z) < 0.48) {
    if (Math.round(x / 0.3) % 2 === 0) return 'dark';
  }
  return 'accent'; // red upper
}

const SNEAKER_RED = '#C2371E';
const YAW = 0.42;

/** Fit pre-built faces into a target box within the panel's viewBox. */
function fitFaces(
  probe: RenderFace[],
  box: { x: number; y: number; width: number; height: number },
): Projection {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const face of probe) {
    for (const pair of face.points.split(' ')) {
      const [px, py] = pair.split(',').map(Number);
      if (px === undefined || py === undefined) continue;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }
  const scale = Math.min(box.width / Math.max(1e-6, maxX - minX), box.height / Math.max(1e-6, maxY - minY));
  return {
    baseY: box.y + box.height / 2 - ((minY + maxY) / 2) * scale,
    centerX: box.x + box.width / 2 - ((minX + maxX) / 2) * scale,
    scale,
  };
}

/** Smooth "photo" sneaker for the polaroid card (vector, not bricks). */
function PhotoSneaker() {
  return (
    <G>
      {/* sole + outsole */}
      <Path d="M56 208 L174 202 Q186 202 186 212 Q186 222 174 223 L66 228 Q54 228 54 218 Z" fill="#F2EFE8" stroke="#17130A" strokeWidth="2.5" />
      <Path d="M54 220 L186 214 L186 218 Q186 224 174 225 L66 230 Q56 230 54 224 Z" fill="#17130A" />
      {/* red upper */}
      <Path d="M60 208 C57 162 64 132 76 122 L94 114 C100 140 116 160 140 170 L168 180 C178 184 184 194 182 204 L56 210 Z" fill={SNEAKER_RED} stroke="#17130A" strokeWidth="2.5" />
      {/* heel patch */}
      <Path d="M60 206 C59 184 60 170 64 160 L78 166 C74 178 72 192 72 205 Z" fill="#F2EFE8" stroke="#17130A" strokeWidth="2" />
      {/* toe cap */}
      <Path d="M146 172 C158 177 172 182 182 202 L182 203 L146 205 C146 192 146 180 142 172 Z" fill="#F2EFE8" stroke="#17130A" strokeWidth="2.5" />
      {/* collar */}
      <Path d="M74 124 L94 114 L99 128 C89 130 82 134 78 140 Z" fill="#17130A" />
      {/* laces */}
      <Path d="M100 136 L118 148 M106 128 L124 140 M96 146 L112 158" stroke="#17130A" strokeLinecap="round" strokeWidth="4" />
    </G>
  );
}

export function ObjectSculpture({ scanLines = false }: ObjectSculptureProps) {
  const { wireFaces, brickFaces } = useMemo(() => {
    const model = voxelize(classifySneaker, 0.16, {
      minX: -2.1, maxX: 2.3, minY: 0, maxY: 2.7, minZ: -0.9, maxZ: 0.9,
    });
    const probe = buildRenderFaces(YAW, SNEAKER_RED, model, { baseY: 0, centerX: 0, scale: 1 });
    const wire = buildRenderFaces(YAW, SNEAKER_RED, model, fitFaces(probe, { x: 236, y: 84, width: 132, height: 136 }));
    const brick = buildRenderFaces(YAW, SNEAKER_RED, model, fitFaces(probe, { x: 432, y: 46, width: 186, height: 212 }));
    return { brickFaces: brick, wireFaces: wire };
  }, []);

  return (
    <View
      accessibilityLabel="How it works: your photo becomes a scanned model, then a brick-built sneaker generated by the engine"
      style={styles.frame}
    >
      <Svg height="100%" viewBox="0 0 640 300" width="100%">
        <Rect fill={colors.ink} height="300" width="640" />
        <Rect fill={inkAlpha(0.4)} height="300" width="640" />

        {/* faint floor grid under the result */}
        <G opacity={0.14} stroke={colors.white} strokeWidth="0.7">
          <Path d="M420 258 L640 258 M440 276 L640 276 M470 240 L640 240" />
          <Path d="M470 230 L450 292 M530 230 L522 292 M590 230 L594 292" />
        </G>

        {/* ---- Stage 1: the photo card ---- */}
        <G rotation={-3} originX={116} originY={160}>
          <Rect fill={colors.white} height={196} rx={14} width={172} x={30} y={62} />
          <Rect fill="#D8D2CA" height={164} rx={8} width={148} x={42} y={78} />
          <PhotoSneaker />
          <Rect fill={colors.saffron} height={26} rx={13} width={104} x={42} y={50} />
          <SvgText fill={colors.ink} fontFamily={fonts.extrabold} fontSize="12" letterSpacing="0.5" x={58} y={68}>
            YOUR PHOTO
          </SvgText>
        </G>

        {/* ---- Stage 2: the scan ---- */}
        <G stroke={colors.saffron} strokeWidth="3" opacity={0.9}>
          <Path d="M228 78 h-16 v16 M356 78 h16 v16 M228 226 h-16 v-16 M356 226 h16 v-16" fill="none" />
        </G>
        {scanLines ? (
          <G opacity={0.4} stroke={colors.saffron} strokeWidth="1">
            <Path d="M216 110 H372 M216 152 H372 M216 194 H372" />
          </G>
        ) : null}
        <G>
          {wireFaces.map((face) => (
            <Polygon fill="none" key={face.id} points={face.points} stroke={saffronAlpha(0.55)} strokeWidth="0.4" />
          ))}
        </G>
        {/* drifting pixels between scan and result */}
        <G fill={colors.saffron}>
          <Rect height="6" opacity="0.9" width="6" x={368} y={104} />
          <Rect height="5" opacity="0.6" width="5" x={382} y={140} />
          <Rect height="7" opacity="0.75" width="7" x={374} y={186} />
          <Rect height="4" opacity="0.5" width="4" x={390} y={214} />
        </G>

        {/* arrow */}
        <Path d="M390 148 h22 m0 0 l-8 -8 m8 8 l-8 8" fill="none" stroke={colors.saffron} strokeLinecap="round" strokeWidth="4" />

        {/* ---- Stage 3: the brick build ---- */}
        <G stroke="#0A0C12" strokeLinejoin="round" strokeWidth="0.4">
          {brickFaces.map((face) => (
            <Polygon fill={face.fill} key={face.id} points={face.points} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 640 / 300,
    backgroundColor: colors.ink,
    borderColor: '#31384D',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    width: '100%',
  },
});
