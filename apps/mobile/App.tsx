import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
import { requiresGuidedMultiview } from './src/lib/photoEngine/imageTo3D';
import type { Segmentation } from './src/lib/photoEngine/segment';
import type { PhotoModels } from './src/lib/photoEngine/voxelizePhoto';
import { colors } from './src/theme/tokens';
import type {
  BuildFill,
  BuildProduct,
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

function samePhotoInput(a: Segmentation | null, b: Segmentation): boolean {
  if (!a) return false;
  const cropMatches = (['x', 'y', 'width', 'height'] as const).every(
    (key) => Math.abs(a.region[key] - b.region[key]) < 0.0001,
  );
  return (
    cropMatches &&
    a.backgroundMode === b.backgroundMode &&
    a.maskSource === b.maskSource &&
    a.mask.length === b.mask.length &&
    a.mask.every((value, index) => value === b.mask[index])
  );
}

export default function App() {
  const live3DAvailable =
    Platform.OS === 'web' && (process.env.EXPO_PUBLIC_TRIPO_ENABLED ?? '') === '1';
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
  const [panelBuild, setPanelBuild] = useState<PhotoModels | null>(null);
  const [sculptureBuild, setSculptureBuild] = useState<PhotoModels | null>(null);
  const [buildProduct, setBuildProduct] = useState<BuildProduct>('panel');
  const [photoSegmentation, setPhotoSegmentation] = useState<Segmentation | null>(null);
  const humanSubjectRequiresGuided3D = requiresGuidedMultiview(photoSegmentation);
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
  const [true3DError, setTrue3DError] = useState('');
  // Approve-first flow: the generated 3D model waits here (with its raw
  // stills) for a yes/no before any brick conversion happens.
  const [pending3D, setPending3D] = useState<{
    meshUrl: string;
    sourceRevision: number;
    sourceUri: string;
    stills: string[];
  } | null>(null);
  const true3DRequestRef = useRef(false);
  const currentPhotoUriRef = useRef(photoUri);
  currentPhotoUriRef.current = photoUri;
  /** Changes whenever the exact crop/matte input changes, even on the same URI. */
  const photoInputRevisionRef = useRef(0);
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
      setPanelBuild(null);
      setSculptureBuild(models);
      setBuildProduct('sculpture');
      setPhotoBuild(models);
      saveBuild(entry.name, models.models.balanced, colorHex, {
        hasDepth: models.hasDepth,
        mode: models.mode,
        product: 'sculpture',
        provenance: 'library',
        style: models.style,
      });
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

  /**
   * Approve-first True 3D: a paid provider creates a real textured mesh,
   * the buyer approves that mesh, and only then do we convert it to bricks.
   * There is deliberately no demo or depth-relief fallback in this path.
   */
  const rebuildTrue3D = async () => {
    if (true3DRequestRef.current) return;
    if (humanSubjectRequiresGuided3D) {
      setBuildProduct('sculpture');
      setTrue3DError('People need front, left, back and right photos for True 3D.');
      setCaptureMode('orbit');
      navigate('capture');
      return;
    }
    true3DRequestRef.current = true;
    setBuildProduct('sculpture');
    setTrue3DState('working');
    setTrue3DNote('');
    setTrue3DError('');
    try {
      const mod = await import('./src/lib/photoEngine/imageTo3D');
      if (!photoUri) {
        throw new Error('Add a photo before generating a 3D sculpture.');
      }
      if (!mod.isLive3DConfigured()) {
        throw new mod.NotConfiguredError();
      }
      const sourceUri = photoUri;
      const sourceRevision = photoInputRevisionRef.current;
      const meshUrl = await mod.generateMeshFromPhoto(sourceUri, photoSegmentation, {
        onProgress: (fraction, note) =>
          setTrue3DNote(`${Math.round(fraction * 100)}% · ${note}`),
      });
      if (
        currentPhotoUriRef.current !== sourceUri ||
        photoInputRevisionRef.current !== sourceRevision
      ) {
        throw new Error('The photo crop or background changed while 3D generation was running. Please start again.');
      }
      setTrue3DNote('Preparing the preview');
      const { snapshotGlb } = await import('./src/lib/photoEngine/meshSnapshot');
      const stills = await snapshotGlb(meshUrl).catch(() => [] as string[]);
      setPending3D({ meshUrl, sourceRevision, sourceUri, stills });
      setTrue3DState('idle');
    } catch (error) {
      setTrue3DError(error instanceof Error ? error.message : '3D generation failed.');
      setTrue3DState('failed');
    } finally {
      true3DRequestRef.current = false;
    }
  };

  /** Re-render approval stills from the existing mesh without another paid provider task. */
  const retry3DPreview = async () => {
    if (!pending3D || true3DRequestRef.current) return;
    const { meshUrl, sourceRevision, sourceUri } = pending3D;
    true3DRequestRef.current = true;
    setTrue3DState('working');
    setTrue3DNote('Rendering the approval preview');
    setTrue3DError('');
    try {
      if (
        currentPhotoUriRef.current !== sourceUri ||
        photoInputRevisionRef.current !== sourceRevision
      ) {
        throw new Error('That 3D model belongs to an older photo. Generate it again for this photo.');
      }
      const { snapshotGlb } = await import('./src/lib/photoEngine/meshSnapshot');
      const stills = await snapshotGlb(meshUrl);
      if (!stills.length) throw new Error('The 3D preview could not be rendered in this browser.');
      setPending3D((current) =>
        current?.meshUrl === meshUrl ? { ...current, stills } : current,
      );
      setTrue3DState('idle');
    } catch (error) {
      setTrue3DError(error instanceof Error ? error.message : 'The 3D preview could not be rendered.');
      setTrue3DState('failed');
    } finally {
      true3DRequestRef.current = false;
    }
  };

  /** The buyer approved the 3D model — brick it at all three profiles. */
  const approve3D = async () => {
    if (!pending3D || true3DRequestRef.current) return;
    const { meshUrl, sourceRevision, sourceUri } = pending3D;
    if (
      currentPhotoUriRef.current !== sourceUri ||
      photoInputRevisionRef.current !== sourceRevision
    ) {
      setPending3D(null);
      setTrue3DError('That 3D model belongs to an older photo. Generate it again for this photo.');
      setTrue3DState('failed');
      return;
    }
    true3DRequestRef.current = true;
    setPending3D(null);
    setTrue3DState('working');
    setTrue3DNote('Converting to bricks');
    setTrue3DError('');
    try {
      const mod = await import('./src/lib/photoEngine/imageTo3D');
      const models = await mod.buildFromMeshUrlAllProfiles(meshUrl, 'your object', (fraction, note) =>
        setTrue3DNote(`${Math.round(fraction * 100)}% · ${note}`),
      );
      if (
        currentPhotoUriRef.current !== sourceUri ||
        photoInputRevisionRef.current !== sourceRevision
      ) {
        throw new Error('The photo crop or background changed while brick conversion was running.');
      }
      setSculptureBuild(models);
      setBuildProduct('sculpture');
      setPhotoBuild(models);
      saveBuild(models.label, models.models.balanced, colors.blue, {
        hasDepth: models.hasDepth,
        mode: models.mode,
        product: 'sculpture',
        provenance: 'provider-3d',
        style: models.style,
      });
      setTrue3DState('done');
    } catch (error) {
      // Keep the already-paid mesh available so a local conversion retry does
      // not force the buyer to purchase another provider generation.
      setPending3D(pending3D);
      setTrue3DError(error instanceof Error ? error.message : 'Brick conversion failed.');
      setTrue3DState('failed');
    } finally {
      true3DRequestRef.current = false;
    }
  };

  const selectBuildProduct = (product: BuildProduct) => {
    setBuildProduct(product);
    setPhotoBuild(product === 'panel' ? panelBuild : sculptureBuild);
  };

  const recordSegmentation = (next: Segmentation) => {
    if (!samePhotoInput(photoSegmentation, next)) {
      photoInputRevisionRef.current += 1;
      setSculptureBuild(null);
      setPending3D(null);
      setTrue3DState('idle');
      setTrue3DNote('');
      setTrue3DError('');
    }
    setPhotoSegmentation(next);
  };

  const navigate = (destination: DemoScreen) => {
    if (destination === screen) {
      return;
    }

    const needsApprovedBuild = new Set<DemoScreen>([
      'bom',
      'purchase',
      'stores',
      'checkout',
      'instructions',
    ]).has(destination);
    const activeBuild = buildProduct === 'panel' ? panelBuild : sculptureBuild;
    if (needsApprovedBuild && !activeBuild) {
      setTrue3DError('Generate and approve the 3D sculpture before opening its parts or build steps.');
      return;
    }

    setHistory((current) => [...current, screen]);
    setScreen(destination);
  };

  const goBack = () => {
    const destination = history[history.length - 1] ?? 'home';
    if (destination === 'capture' && panelBuild) {
      setBuildProduct('panel');
      setPhotoBuild(panelBuild);
    }
    setHistory((current) => current.slice(0, -1));
    setScreen(destination);
  };

  const restart = () => {
    setSampleUsed(false);
    setPhotoUri(null);
    setRightsConfirmedUri(null);
    setPhotoBuild(null);
    setPanelBuild(null);
    setSculptureBuild(null);
    setBuildProduct('panel');
    setPhotoSegmentation(null);
    setPending3D(null);
    setTrue3DState('idle');
    setTrue3DNote('');
    setTrue3DError('');
    setHistory([]);
    setScreen('home');
  };

  const renderScreen = () => {
    const activeBuild = buildProduct === 'panel' ? panelBuild : sculptureBuild;
    switch (screen) {
      case 'home':
        return (
          <HomeScreen
            onOpenBuild={(saved) => {
              const model = loadModel(saved);
              setPhotoUri(null);
              setRightsConfirmedUri(null);
              const restoredAsSculpture =
                saved.product === 'sculpture' &&
                (saved.provenance === 'provider-3d' || saved.provenance === 'library');
              const restoredBuild: PhotoModels = {
                hasDepth: restoredAsSculpture ? (saved.hasDepth ?? true) : false,
                label: saved.name,
                mode: restoredAsSculpture ? (saved.mode ?? 'volume') : 'relief',
                models: { balanced: model, detailed: model, efficient: model },
                style: saved.style ?? 'natural',
              };
              setPanelBuild(restoredAsSculpture ? null : restoredBuild);
              setSculptureBuild(restoredAsSculpture ? restoredBuild : null);
              setBuildProduct(restoredAsSculpture ? 'sculpture' : 'panel');
              setPhotoBuild(restoredBuild);
              setTrue3DState(restoredAsSculpture ? 'done' : 'idle');
              navigate('result');
            }}
            onOpenLibrary={() => navigate('library')}
            onStart={() => {
              setCaptureMode('photo');
              navigate('mode');
            }}
            onStart3D={() => {
              setCaptureMode('orbit');
              navigate('mode');
            }}
          />
        );
      case 'mode':
        return (
          <ModeScreen
            full3DAvailable={live3DAvailable}
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
                setPanelBuild(null);
                setSculptureBuild(models);
                setBuildProduct('sculpture');
                setPhotoBuild(models);
                setPending3D(null);
                setTrue3DState('done');
                saveBuild(models.label, models.models.balanced, colors.blue, {
                  hasDepth: models.hasDepth,
                  mode: models.mode,
                  product: 'sculpture',
                  provenance: 'provider-3d',
                  style: models.style,
                });
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
              setPanelBuild(models);
              setBuildProduct('panel');
              setPhotoBuild(models);
              saveBuild(models.label, models.models.balanced, colors.blue, {
                hasDepth: models.hasDepth,
                mode: models.mode,
                product: 'panel',
                provenance: 'flat-photo',
                style: models.style,
              });
            }}
            onPhotoChange={(uri) => {
              photoInputRevisionRef.current += 1;
              setPhotoUri(uri);
              setPhotoBuild(null);
              setPanelBuild(null);
              setSculptureBuild(null);
              setBuildProduct('panel');
              setPhotoSegmentation(null);
              setRightsConfirmedUri(null);
              setPending3D(null);
              setTrue3DState('idle');
              setTrue3DNote('');
              setTrue3DError('');
            }}
            onRightsConfirmedChange={(confirmed) =>
              setRightsConfirmedUri(confirmed && photoUri ? photoUri : null)
            }
            onSegmentation={recordSegmentation}
            onUseSample={() => {
              setPhotoUri(null);
              setPhotoBuild(null);
              setPanelBuild(null);
              setSculptureBuild(null);
              setBuildProduct('panel');
              setPhotoSegmentation(null);
              setRightsConfirmedUri(null);
              setPending3D(null);
              setTrue3DState('idle');
              setTrue3DNote('');
              setTrue3DError('');
              setSampleUsed(true);
            }}
            photoBuild={activeBuild}
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
            activeProduct={buildProduct}
            panelBuild={panelBuild}
            sculptureBuild={sculptureBuild}
            onSelectProduct={selectBuildProduct}
            onGuided3D={() => {
              setCaptureMode('orbit');
              navigate('capture');
            }}
            onTrue3D={rebuildTrue3D}
            onApprove3D={approve3D}
            onRetry3DPreview={retry3DPreview}
            onDiscard3D={() => {
              setPending3D(null);
              setTrue3DState('idle');
            }}
            pending3DStills={pending3D?.stills ?? null}
            photoBuild={activeBuild}
            photoUri={photoUri}
            humanSubject={humanSubjectRequiresGuided3D}
            selectedVariant={selectedVariant}
            true3DState={true3DState}
            true3DNote={true3DNote}
            true3DError={true3DError}
            true3DAvailable={live3DAvailable}
          />
        );
      case 'bom':
        return (
          <BomScreen
            buildFill={buildFill}
            onBack={goBack}
            onNavigate={navigate}
            photoBuild={activeBuild}
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
            photoBuild={activeBuild}
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
              photoInputRevisionRef.current += 1;
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
              activeBuild ? activeBuild.label.charAt(0).toUpperCase() + activeBuild.label.slice(1) : 'PixBrik build'
            }
            countryCode={countryCode}
            onBack={goBack}
            onDone={restart}
            photoBuild={activeBuild}
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
