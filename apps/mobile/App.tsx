import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { PaperCanvas } from './src/components/PaperCanvas';
import { BomScreen } from './src/screens/BomScreen';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { InstructionsScreen } from './src/screens/InstructionsScreen';
import { ModeScreen } from './src/screens/ModeScreen';
import { PreferencesScreen } from './src/screens/PreferencesScreen';
import { ProgressScreen } from './src/screens/ProgressScreen';
import { PurchaseScreen } from './src/screens/PurchaseScreen';
import { ResultScreen } from './src/screens/ResultScreen';
import { AdminScreen } from './src/screens/AdminScreen';
import { CheckoutScreen } from './src/screens/CheckoutScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { StoresScreen } from './src/screens/StoresScreen';
import type { LibraryEntry } from './src/data/carLibrary';
import { loadModel, saveBuild } from './src/lib/buildGallery';
import type { Segmentation } from './src/lib/photoEngine/segment';
import type { PhotoModels } from './src/lib/photoEngine/voxelizePhoto';
import { colors } from './src/theme/tokens';
import type {
  BuildFill,
  CaptureMode,
  DemoScreen,
  DetailLevel,
  PaletteMode,
  TargetSize,
} from './src/types/navigation';

export default function App() {
  const [screen, setScreen] = useState<DemoScreen>('home');
  const [history, setHistory] = useState<DemoScreen[]>([]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBuild, setPhotoBuild] = useState<PhotoModels | null>(null);
  const [photoSegmentation, setPhotoSegmentation] = useState<Segmentation | null>(null);
  const [sampleUsed, setSampleUsed] = useState(false);
  const captured = photoBuild !== null || sampleUsed;
  const [size, setSize] = useState<TargetSize>('shelf');
  const [detail, setDetail] = useState<DetailLevel>('balanced');
  const [palette, setPalette] = useState<PaletteMode>('true');
  const [selectedVariant, setSelectedVariant] = useState('balanced');
  const [countryCode, setCountryCode] = useState('FR');
  const [buildFill, setBuildFill] = useState<BuildFill>('full');
  const [true3DState, setTrue3DState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [dimensionWorking, setDimensionWorking] = useState(false);
  const [libraryGenerating, setLibraryGenerating] = useState(false);

  const generateFromLibrary = async (entry: LibraryEntry, colorHex: string) => {
    if (!entry.meshUrl) return;
    setLibraryGenerating(true);
    try {
      const { buildFromLibrary } = await import('./src/lib/photoEngine/imageTo3D');
      const models = await buildFromLibrary(entry.meshUrl, entry.name, colorHex);
      setPhotoUri(null);
      setSampleUsed(false);
      setPhotoSegmentation(null);
      setPhotoBuild(models);
      saveBuild(entry.name, models.models.balanced, colorHex);
      navigate('result');
    } catch {
      // stay on library on failure
    } finally {
      setLibraryGenerating(false);
    }
  };

  // TEMP bake hook: voxelize a mesh via the (known-good) imageTo3D chunk and
  // serialize compact baked data for the homepage heroes.
  useEffect(() => {
    (globalThis as unknown as { __bake?: (url: string, res?: string) => Promise<unknown> }).__bake = async (
      url: string,
      res = 'efficient',
    ) => {
      const { buildFromMeshUrl } = await import('./src/lib/photoEngine/imageTo3D');
      const pm = await buildFromMeshUrl(url, 'baked');
      const model = pm.models[res as 'efficient' | 'balanced' | 'detailed'];
      const palette: string[] = [];
      const index = new Map<string, number>();
      const cells: number[][] = [];
      for (const cell of model.cells) {
        const hex = cell.colorHex ?? '#cccccc';
        let pi = index.get(hex);
        if (pi === undefined) {
          pi = palette.length;
          palette.push(hex);
          index.set(hex, pi);
        }
        cells.push([cell.i, cell.j, cell.k, pi]);
      }
      return { size: model.size, palette, cells };
    };
  }, []);

  /** Flat panel ↔ full 3D (depth-inflated) for a photo build. */
  const toggleDimension = async () => {
    if (!photoBuild || !photoSegmentation || !photoUri) return;
    setDimensionWorking(true);
    try {
      const nextMode = photoBuild.mode === 'relief' ? 'volume' : 'relief';
      const seg = photoSegmentation;
      if (nextMode === 'volume' && seg.depth === undefined) {
        const { estimateDepthGrid, isDepthSupported } = await import('./src/lib/photoEngine/depth');
        seg.depth = isDepthSupported() ? await estimateDepthGrid(photoUri, seg.region, seg.grid) : null;
      }
      const { buildPhotoModels } = await import('./src/lib/photoEngine/voxelizePhoto');
      setPhotoBuild(
        buildPhotoModels(seg, photoBuild.label, nextMode, undefined, {
          category: seg.categoryLabel,
          face: seg.face ?? null,
          preserveFeatures: seg.preserveFeatures ?? false,
        }),
      );
    } catch {
      // keep current build on failure
    } finally {
      setDimensionWorking(false);
    }
  };

  const rebuildTrue3D = async () => {
    setTrue3DState('working');
    try {
      const mod = await import('./src/lib/photoEngine/imageTo3D');
      // Real photo + live generation on → send it to Tripo. Otherwise fall
      // back to the demo mesh so the pipeline is always demonstrable.
      if (photoUri && mod.isLive3DConfigured()) {
        const models = await mod.buildFromPhoto(photoUri);
        setPhotoBuild(models);
        saveBuild(models.label, models.models.balanced, colors.blue);
      } else {
        const demo = mod.DEMO_MESHES[0];
        const models = await mod.buildFromMeshUrl(demo.url, demo.label);
        setPhotoUri(null);
        setPhotoBuild(models);
      }
      setTrue3DState('done');
    } catch {
      setTrue3DState('failed');
    }
  };

  const navigate = (destination: DemoScreen) => {
    if (destination === screen) {
      return;
    }

    setHistory((current) => [...current, screen]);
    setScreen(destination);
  };

  const goBack = () => {
    const destination = history[history.length - 1] ?? 'home';
    setHistory((current) => current.slice(0, -1));
    setScreen(destination);
  };

  const restart = () => {
    setSampleUsed(false);
    setPhotoUri(null);
    setPhotoBuild(null);
    setPhotoSegmentation(null);
    setHistory([]);
    setScreen('home');
  };

  const renderScreen = () => {
    switch (screen) {
      case 'home':
        return (
          <HomeScreen
            onOpenBuild={(saved) => {
              const model = loadModel(saved);
              setPhotoUri(null);
              setPhotoBuild({
                hasDepth: false,
                label: saved.name,
                mode: 'volume',
                models: { balanced: model, detailed: model, efficient: model },
                style: 'natural',
              });
              navigate('result');
            }}
            onOpenLibrary={() => navigate('library')}
            onStart={() => navigate('mode')}
          />
        );
      case 'mode':
        return (
          <ModeScreen
            onBack={goBack}
            onChange={setCaptureMode}
            onContinue={() => navigate('capture')}
            value={captureMode}
          />
        );
      case 'capture':
        return (
          <CaptureScreen
            captured={captured}
            mode={captureMode}
            onBack={goBack}
            onContinue={() => navigate('preferences')}
            onObjectLocked={(models) => {
              setPhotoBuild(models);
              saveBuild(models.label, models.models.balanced, colors.blue);
            }}
            onPhotoChange={(uri) => {
              setPhotoUri(uri);
              setPhotoBuild(null);
              setPhotoSegmentation(null);
            }}
            onSegmentation={setPhotoSegmentation}
            onUseSample={() => {
              setPhotoUri(null);
              setPhotoBuild(null);
              setPhotoSegmentation(null);
              setSampleUsed(true);
            }}
            photoBuild={photoBuild}
            photoUri={photoUri}
            segmentation={photoSegmentation}
          />
        );
      case 'preferences':
        return (
          <PreferencesScreen
            detail={detail}
            onBack={goBack}
            onContinue={() => navigate('progress')}
            onDetailChange={setDetail}
            onPaletteChange={setPalette}
            onSizeChange={setSize}
            palette={palette}
            size={size}
          />
        );
      case 'progress':
        return <ProgressScreen onBack={goBack} onContinue={() => navigate('result')} />;
      case 'result':
        return (
          <ResultScreen
            onBack={goBack}
            onNavigate={navigate}
            onSelectVariant={setSelectedVariant}
            canToggleDimension={!!(photoBuild && photoSegmentation && photoUri)}
            dimensionMode={photoBuild?.mode}
            dimensionWorking={dimensionWorking}
            onToggleDimension={toggleDimension}
            onTrue3D={rebuildTrue3D}
            photoBuild={photoBuild}
            photoUri={photoUri}
            selectedVariant={selectedVariant}
            true3DState={true3DState}
          />
        );
      case 'bom':
        return (
          <BomScreen
            onBack={goBack}
            onNavigate={navigate}
            photoBuild={photoBuild}
            selectedVariant={selectedVariant}
          />
        );
      case 'purchase':
        return (
          <PurchaseScreen
            buildFill={buildFill}
            countryCode={countryCode}
            onBack={goBack}
            onBuildFillChange={setBuildFill}
            onCountryChange={setCountryCode}
            onNavigate={navigate}
            photoBuild={photoBuild}
            selectedVariant={selectedVariant}
          />
        );
      case 'stores':
        return <StoresScreen onBack={goBack} onNavigate={navigate} />;
      case 'library':
        return (
          <LibraryScreen
            generating={libraryGenerating}
            onBack={goBack}
            onGenerate={generateFromLibrary}
            onNavigate={navigate}
          />
        );
      case 'admin':
        return <AdminScreen onBack={goBack} />;
      case 'checkout':
        return (
          <CheckoutScreen
            buildFill={buildFill}
            buildName={
              photoBuild ? photoBuild.label.charAt(0).toUpperCase() + photoBuild.label.slice(1) : 'Signal Fox'
            }
            countryCode={countryCode}
            onBack={goBack}
            onDone={restart}
            photoBuild={photoBuild}
            selectedVariant={selectedVariant}
          />
        );
      case 'instructions':
        return (
          <InstructionsScreen
            onBack={goBack}
            onNavigate={navigate}
            onRestart={restart}
          />
        );
    }
  };

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="dark" />
      <PaperCanvas>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
          {renderScreen()}
        </SafeAreaView>
      </PaperCanvas>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
