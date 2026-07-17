import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/archivo';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';

import { PaperCanvas } from './src/components/PaperCanvas';
import { BomScreen } from './src/screens/BomScreen';
import { Capture360Screen } from './src/screens/Capture360Screen';
import { CaptureScreen } from './src/screens/CaptureScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { InstructionsScreen } from './src/screens/InstructionsScreen';
import { ModeScreen } from './src/screens/ModeScreen';
import { PreferencesScreen, variantForPreferences } from './src/screens/PreferencesScreen';
import { ProgressScreen } from './src/screens/ProgressScreen';
import { PurchaseScreen } from './src/screens/PurchaseScreen';
import { ResultScreen } from './src/screens/ResultScreen';
import { AdminScreen } from './src/screens/AdminScreen';
import { CheckoutScreen } from './src/screens/CheckoutScreen';
import { LabScreen } from './src/screens/LabScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { StoresScreen } from './src/screens/StoresScreen';
import type { LibraryEntry } from './src/data/carLibrary';
import { loadModel, saveBuild } from './src/lib/buildGallery';
import { NavigationContext } from './src/lib/navigationContext';
import type { Segmentation } from './src/lib/photoEngine/segment';
import type { PhotoModels } from './src/lib/photoEngine/voxelizePhoto';
import { colors } from './src/theme/tokens';
import type {
  BuildFill,
  CaptureMode,
  DemoScreen,
  DetailLevel,
  TargetSize,
} from './src/types/navigation';

/**
 * Hidden deep link: #lab (or ?lab) opens the model-comparison lab + Coach
 * directly — an internal tool, deliberately not linked from the home page.
 */
function initialScreen(): DemoScreen {
  if (typeof window !== 'undefined' && /[#?&]lab\b/.test(window.location.hash + window.location.search)) {
    return 'lab';
  }
  return 'home';
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    ArchivoBlack_400Regular,
  });
  const [screen, setScreen] = useState<DemoScreen>(initialScreen);
  const [history, setHistory] = useState<DemoScreen[]>([]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBuild, setPhotoBuild] = useState<PhotoModels | null>(null);
  const [photoSegmentation, setPhotoSegmentation] = useState<Segmentation | null>(null);
  const [rightsConfirmedUri, setRightsConfirmedUri] = useState<string | null>(null);
  const [sampleUsed, setSampleUsed] = useState(false);
  // A picked photo is already a valid capture-state, even before its brick
  // preview has finished building. Keeping it out of this flag left the
  // fixed footer stuck on "Add a photo first" over the real next action.
  const captured = photoUri !== null || photoBuild !== null || sampleUsed;
  const [size, setSize] = useState<TargetSize>('shelf');
  const [detail, setDetail] = useState<DetailLevel>('balanced');
  const [selectedVariant, setSelectedVariant] = useState('balanced');
  const [countryCode, setCountryCode] = useState('FR');
  // Hollow is the standard kit: identical from the outside, a fraction of
  // the parts and price. Solid is the collector upsell, not the default.
  const [buildFill, setBuildFill] = useState<BuildFill>('hollow');
  const [true3DState, setTrue3DState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');
  const [true3DNote, setTrue3DNote] = useState('');
  // Approve-first flow: the generated 3D model waits here (with its raw
  // stills) for a yes/no before any brick conversion happens.
  const [pending3D, setPending3D] = useState<{ meshUrl: string; stills: string[] } | null>(null);
  const [dimensionWorking, setDimensionWorking] = useState(false);
  const [libraryGenerating, setLibraryGenerating] = useState(false);

  const generateFromLibrary = async (entry: LibraryEntry, colorHex: string) => {
    if (!entry.meshUrl) return;
    setLibraryGenerating(true);
    try {
      const { buildFromLibrary } = await import('./src/lib/photoEngine/imageTo3D');
      const models = await buildFromLibrary(entry.meshUrl, entry.name, colorHex);
      setPhotoUri(null);
      setRightsConfirmedUri(null);
      setSampleUsed(false);
      setPhotoSegmentation(null);
      setPhotoBuild(models);
      saveBuild(entry.name, models.models.balanced, colorHex);
      navigate('result');
    } catch (error) {
      // Stay on the library, but never swallow the reason silently.
      console.error('[library] build failed:', error);
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
        buildPhotoModels(seg, photoBuild.label, nextMode, nextMode === 'relief' ? photoBuild.style : 'natural', {
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

  /**
   * Approve-first True-3D: generate the mesh (Meshy-6 preferred, Tripo
   * fallback), show its raw stills for a yes/no, and only convert to bricks
   * after approval. No photo / live generation off → the demo mesh walks
   * the same flow so it stays demonstrable.
   */
  const rebuildTrue3D = async () => {
    setTrue3DState('working');
    setTrue3DNote('');
    try {
      const mod = await import('./src/lib/photoEngine/imageTo3D');
      const meshUrl =
        photoUri && mod.isLive3DConfigured()
          ? await mod.generateMeshFromPhoto(photoUri, photoSegmentation, {
              onProgress: (fraction, note) => setTrue3DNote(`${Math.round(fraction * 100)}% · ${note}`),
            })
          : mod.DEMO_MESHES[0].url;
      setTrue3DNote('Preparing the preview');
      const { snapshotGlb } = await import('./src/lib/photoEngine/meshSnapshot');
      const stills = await snapshotGlb(meshUrl).catch(() => [] as string[]);
      setPending3D({ meshUrl, stills });
      setTrue3DState('idle');
    } catch {
      setTrue3DState('failed');
    }
  };

  /** The buyer approved the 3D model — brick it at all three profiles. */
  const approve3D = async () => {
    if (!pending3D) return;
    const meshUrl = pending3D.meshUrl;
    setPending3D(null);
    setTrue3DState('working');
    setTrue3DNote('Converting to bricks');
    try {
      const mod = await import('./src/lib/photoEngine/imageTo3D');
      const models = await mod.buildFromMeshUrlAllProfiles(meshUrl, 'your object', (fraction, note) =>
        setTrue3DNote(`${Math.round(fraction * 100)}% · ${note}`),
      );
      setPhotoBuild(models);
      saveBuild(models.label, models.models.balanced, colors.blue);
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
    setRightsConfirmedUri(null);
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
              setRightsConfirmedUri(null);
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
        if (captureMode === 'orbit') {
          return (
            <Capture360Screen
              onBack={goBack}
              onGenerated={(models, frontUri) => {
                setPhotoUri(frontUri);
                setPhotoSegmentation(null);
                setSampleUsed(false);
                setPhotoBuild(models);
                saveBuild(models.label, models.models.balanced, colors.blue);
                navigate('result');
              }}
            />
          );
        }
        return (
          <CaptureScreen
            captured={captured}
            mode={captureMode}
            onBack={goBack}
            onContinue={() => {
              setSelectedVariant('balanced');
              navigate('result');
            }}
            onObjectLocked={(models) => {
              setPhotoBuild(models);
              saveBuild(models.label, models.models.balanced, colors.blue);
            }}
            onPhotoChange={(uri) => {
              setPhotoUri(uri);
              setPhotoBuild(null);
              setPhotoSegmentation(null);
              setRightsConfirmedUri(null);
            }}
            onRightsConfirmedChange={(confirmed) =>
              setRightsConfirmedUri(confirmed && photoUri ? photoUri : null)
            }
            onSegmentation={setPhotoSegmentation}
            onUseSample={() => {
              setPhotoUri(null);
              setPhotoBuild(null);
              setPhotoSegmentation(null);
              setRightsConfirmedUri(null);
              setSampleUsed(true);
            }}
            photoBuild={photoBuild}
            photoUri={photoUri}
            rightsConfirmed={!!photoUri && rightsConfirmedUri === photoUri}
            segmentation={photoSegmentation}
          />
        );
      case 'preferences':
        return (
          <PreferencesScreen
            detail={detail}
            onBack={goBack}
            onContinue={() => {
              setSelectedVariant(variantForPreferences(size, detail));
              navigate('result');
            }}
            onDetailChange={setDetail}
            onSizeChange={setSize}
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
            onGuided3D={() => {
              setCaptureMode('orbit');
              navigate('capture');
            }}
            onToggleDimension={toggleDimension}
            onTrue3D={rebuildTrue3D}
            onApprove3D={approve3D}
            onDiscard3D={() => setPending3D(null)}
            pending3DStills={pending3D?.stills ?? null}
            photoBuild={photoBuild}
            photoUri={photoUri}
            selectedVariant={selectedVariant}
            true3DState={true3DState}
            true3DNote={true3DNote}
          />
        );
      case 'bom':
        return (
          <BomScreen
            buildFill={buildFill}
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
      case 'lab':
        return (
          <LabScreen
            onBack={goBack}
            onRestore={(uri, segmentation) => {
              setPhotoUri(uri);
              setPhotoSegmentation(segmentation);
              setSampleUsed(false);
            }}
            photoUri={photoUri}
            segmentation={photoSegmentation}
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

  if (!fontsLoaded) {
    return <View style={styles.fontGate} />;
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="dark" />
      <PaperCanvas>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
          <NavigationContext.Provider value={navigate}>{renderScreen()}</NavigationContext.Provider>
        </SafeAreaView>
      </PaperCanvas>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  fontGate: {
    backgroundColor: colors.saffron,
    flex: 1,
  },
});
