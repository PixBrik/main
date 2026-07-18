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
import { AccountScreen } from './src/screens/AccountScreen';
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
import { CheckoutScreen } from './src/screens/CheckoutScreen';
import { LabScreen } from './src/screens/LabScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { StoresScreen } from './src/screens/StoresScreen';
import { SharedGuideLoadingScreen } from './src/screens/SharedGuideLoadingScreen';
import { ContactScreen } from './src/screens/ContactScreen';
import { LegalHubScreen } from './src/screens/LegalHubScreen';
import { PrivacyScreen } from './src/screens/PrivacyScreen';
import { TermsScreen } from './src/screens/TermsScreen';
import type { LibraryEntry } from './src/data/carLibrary';
import { loadModel, saveBuild } from './src/lib/buildGallery';
import { accentForVariant, profileForVariant, resolveActiveModel } from './src/lib/activeBuild';
import { hollowBuildModel } from './src/lib/brickify';
import { clear360Capture, clear360ProviderRuns } from './src/lib/capture360Store';
import { NavigationContext } from './src/lib/navigationContext';
import { PixBrikAuthProvider } from './src/lib/pixbrikAuth';
import { LEGAL_CONTENT_AVAILABLE } from './src/lib/legalAvailability';
import { loadOrderModel, type OrderRecord } from './src/lib/orderStore';
import {
  loadGuideModel,
  loadPublishedGuide,
  readGuideShareId,
  type PublishedGuideSnapshot,
} from './src/lib/guideShare';
import {
  recolorPhotoModels,
  requiresGuidedMultiview,
  type MeshBrickColorStyle,
} from './src/lib/photoEngine/imageTo3D';
import type { Segmentation } from './src/lib/photoEngine/segment';
import type { PhotoModels } from './src/lib/photoEngine/voxelizePhoto';
import { colors } from './src/theme/tokens';
import type {
  BuildFill,
  BuildProduct,
  CaptureMode,
  DemoScreen,
  TargetSize,
} from './src/types/navigation';
import type { LegalLocale } from './src/legal/legalContent';

const LEGAL_DOCUMENT_SCREENS = new Set<DemoScreen>(['legal', 'terms', 'privacy']);
const PUBLIC_INFORMATION_SCREENS = new Set<DemoScreen>([
  ...LEGAL_DOCUMENT_SCREENS,
  'contact',
]);
const ADDRESSABLE_SCREENS = new Set<DemoScreen>([
  ...PUBLIC_INFORMATION_SCREENS,
  'account',
]);
const LEGAL_LOCALES = new Set<LegalLocale>(['en', 'fr', 'es', 'it', 'ar']);
const LEGAL_LOCALE_STORAGE_KEY = 'pixbrik.legal-locale';

function legalScreenFromLocation(): DemoScreen | null {
  if (typeof window === 'undefined') return null;
  const candidate = window.location.hash.replace(/^#/, '') as DemoScreen;
  if (candidate === 'contact') return candidate;
  return LEGAL_CONTENT_AVAILABLE && LEGAL_DOCUMENT_SCREENS.has(candidate) ? candidate : null;
}

function accountScreenFromLocation(): DemoScreen | null {
  if (typeof window === 'undefined') return null;
  return /^\/account(?:\/|$)/.test(window.location.pathname) ? 'account' : null;
}

function locationForScreen(screen: DemoScreen): string {
  if (typeof window === 'undefined') return '/';
  const search = window.location.search;
  if (screen === 'account') return `/account${search}`;
  if (PUBLIC_INFORMATION_SCREENS.has(screen)) return `/${search}#${screen}`;
  return `/${search}`;
}

function initialLegalLocale(): LegalLocale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(LEGAL_LOCALE_STORAGE_KEY) as LegalLocale | null;
    if (stored && LEGAL_LOCALES.has(stored)) return stored;
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
  const browserLocale = window.navigator.language.toLowerCase().split(/[-_]/)[0] as LegalLocale;
  return LEGAL_LOCALES.has(browserLocale) ? browserLocale : 'en';
}

/**
 * Hidden deep link: #lab (or ?lab) opens the model-comparison lab + Coach
 * directly — an internal tool, deliberately not linked from the home page.
 */
function initialScreen(): DemoScreen {
  if (typeof window !== 'undefined' && readGuideShareId(window.location.href)) {
    return 'instructions';
  }
  const accountScreen = accountScreenFromLocation();
  if (accountScreen) return accountScreen;
  const legalScreen = legalScreenFromLocation();
  if (legalScreen) return legalScreen;
  if (typeof window !== 'undefined' && /[#?&]lab\b/.test(window.location.hash + window.location.search)) {
    return 'lab';
  }
  return 'home';
}

function initialGuideId(): string | null {
  return typeof window === 'undefined' ? null : readGuideShareId(window.location.href);
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

const MAX_TRUE_3D_PROVIDER_RUNS = 3;

interface Approved3DRecord {
  capture: 'single' | 'multiview' | 'library' | 'saved';
  meshUrl: string;
  retakesRemaining: number;
  stills: string[];
}

function PixBrikApp() {
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
  const [legalLocale, setLegalLocale] = useState<LegalLocale>(initialLegalLocale);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBuild, setPhotoBuild] = useState<PhotoModels | null>(null);
  const [panelBuild, setPanelBuild] = useState<PhotoModels | null>(null);
  const [sculptureBuild, setSculptureBuild] = useState<PhotoModels | null>(null);
  // Keep the untouched natural conversion as the source of truth. Palette
  // previews clone colours only, so toggling can never re-voxelize or deform it.
  const [naturalSculptureBuild, setNaturalSculptureBuild] = useState<PhotoModels | null>(null);
  const [sculpturePalette, setSculpturePalette] = useState<MeshBrickColorStyle>('natural');
  const [approved3D, setApproved3D] = useState<Approved3DRecord | null>(null);
  const [true3DProviderRuns, setTrue3DProviderRuns] = useState(0);
  const [captureProviderRunsStart, setCaptureProviderRunsStart] = useState(0);
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
  const [selectedVariant, setSelectedVariant] = useState('balanced');
  const [countryCode, setCountryCode] = useState('FR');
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [sharedGuideId] = useState<string | null>(initialGuideId);
  const [sharedGuide, setSharedGuide] = useState<PublishedGuideSnapshot | null>(null);
  const [sharedGuideError, setSharedGuideError] = useState('');
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
  const [libraryGenerationProgress, setLibraryGenerationProgress] = useState(0);

  useEffect(() => {
    if (!sharedGuideId) return;
    let cancelled = false;
    setSharedGuideError('');
    void loadPublishedGuide(sharedGuideId)
      .then((guide) => {
        if (cancelled) return;
        setSharedGuide(guide);
        setSelectedOrder(null);
        setScreen('instructions');
      })
      .catch((error) => {
        if (cancelled) return;
        setSharedGuideError(error instanceof Error ? error.message : 'This guide could not be loaded.');
        setScreen('instructions');
      });
    return () => {
      cancelled = true;
    };
  }, [sharedGuideId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LEGAL_LOCALE_STORAGE_KEY, legalLocale);
    } catch {
      // Locale persistence is helpful, never required for navigation.
    }
    if (PUBLIC_INFORMATION_SCREENS.has(screen)) {
      document.documentElement.lang = legalLocale;
    } else {
      document.documentElement.lang = 'en';
    }
  }, [legalLocale, screen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(
      { ...(window.history.state ?? {}), pixbrikScreen: screen },
      '',
      window.location.href,
    );
    const onPopState = (event: PopStateEvent) => {
      const stateScreen = (event.state as { pixbrikScreen?: unknown } | null)?.pixbrikScreen;
      const destination =
        typeof stateScreen === 'string' &&
        (ADDRESSABLE_SCREENS.has(stateScreen as DemoScreen) ||
          stateScreen === 'home' ||
          stateScreen === 'instructions')
          ? (stateScreen as DemoScreen)
          : accountScreenFromLocation() ?? legalScreenFromLocation() ?? 'home';
      setHistory((current) => current.slice(0, -1));
      setScreen(destination);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const selectSculpturePalette = (style: MeshBrickColorStyle) => {
    if (!naturalSculptureBuild) return;
    const recolored = recolorPhotoModels(naturalSculptureBuild, style);
    setSculpturePalette(style);
    setSculptureBuild(recolored);
    if (buildProduct === 'sculpture') setPhotoBuild(recolored);
  };

  const generateFromLibrary = async (entry: LibraryEntry, colorHex: string) => {
    if (!entry.meshUrl) return;
    setLibraryGenerating(true);
    setLibraryGenerationProgress(0);
    try {
      const { buildFromLibrary } = await import('./src/lib/photoEngine/imageTo3D');
      const models = await buildFromLibrary(
        entry.meshUrl,
        entry.name,
        colorHex,
        setLibraryGenerationProgress,
      );
      setPhotoUri(null);
      setRightsConfirmedUri(null);
      setSampleUsed(false);
      setPhotoSegmentation(null);
      setPanelBuild(null);
      setNaturalSculptureBuild(models);
      setSculptureBuild(models);
      setSculpturePalette('natural');
      setApproved3D({
        capture: 'library',
        meshUrl: entry.meshUrl,
        retakesRemaining: 0,
        stills: [],
      });
      setTrue3DProviderRuns(0);
      setBuildProduct('sculpture');
      setPhotoBuild(models);
      saveBuild(entry.name, models.models.balanced, colorHex, {
        hasDepth: models.hasDepth,
        mode: models.mode,
        product: 'sculpture',
        provenance: 'library',
        source3DMeshUrl: entry.meshUrl,
        source3DRetakesRemaining: 0,
        style: models.style,
      });
      navigate('result');
    } catch (error) {
      // Stay on the library, but never swallow the reason silently.
      console.error('[library] build failed:', error);
    } finally {
      setLibraryGenerating(false);
      setLibraryGenerationProgress(0);
    }
  };

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
      setCaptureProviderRunsStart(0);
      setCaptureMode('orbit');
      navigate('capture');
      return;
    }
    if (true3DProviderRuns >= MAX_TRUE_3D_PROVIDER_RUNS) {
      setTrue3DError('Two 3D retakes have already been used for this photo. Start a new capture to generate again.');
      setTrue3DState('failed');
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
        onProviderTaskCreated: () => {
          setTrue3DProviderRuns((current) =>
            Math.min(MAX_TRUE_3D_PROVIDER_RUNS, current + 1),
          );
        },
      });
      if (
        currentPhotoUriRef.current !== sourceUri ||
        photoInputRevisionRef.current !== sourceRevision
      ) {
        throw new Error('The photo crop or background changed while 3D generation was running. Please start again.');
      }
      // Open the real GLB immediately. Four stills are rendered in the
      // background as a native/failure fallback, but they no longer hold the
      // interactive approval screen hostage.
      setTrue3DNote('Opening the rotatable preview');
      setPending3D({ meshUrl, sourceRevision, sourceUri, stills: [] });
      setTrue3DState('idle');
      void import('./src/lib/photoEngine/meshSnapshot')
        .then(({ snapshotGlb }) => snapshotGlb(meshUrl))
        .then((stills) => {
          if (stills.length < 4) return;
          setPending3D((current) =>
            current?.meshUrl === meshUrl ? { ...current, stills } : current,
          );
        })
        .catch(() => {
          // The interactive GLB remains the approval surface on web. Native
          // can retry still rendering without starting another paid task.
        });
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
      if (stills.length < 4) {
        throw new Error('The 3D preview did not return all four approval angles.');
      }
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
    const { meshUrl, sourceRevision, sourceUri, stills } = pending3D;
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
      const naturalModels = await mod.buildFromMeshUrlAllProfiles(meshUrl, 'your object', (fraction, note) =>
        setTrue3DNote(`${Math.round(fraction * 100)}% · ${note}`),
      );
      if (
        currentPhotoUriRef.current !== sourceUri ||
        photoInputRevisionRef.current !== sourceRevision
      ) {
        throw new Error('The photo crop or background changed while brick conversion was running.');
      }
      const models = recolorPhotoModels(naturalModels, sculpturePalette);
      setNaturalSculptureBuild(naturalModels);
      setSculptureBuild(models);
      setApproved3D({
        capture: 'single',
        meshUrl,
        retakesRemaining: Math.max(0, MAX_TRUE_3D_PROVIDER_RUNS - true3DProviderRuns),
        stills,
      });
      setBuildProduct('sculpture');
      setPhotoBuild(models);
      saveBuild(models.label, models.models.balanced, colors.blue, {
        hasDepth: models.hasDepth,
        mode: models.mode,
        product: 'sculpture',
        provenance: 'provider-3d',
        source3DMeshUrl: meshUrl,
        source3DRetakesRemaining: Math.max(0, MAX_TRUE_3D_PROVIDER_RUNS - true3DProviderRuns),
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
    if (product === 'panel') setBuildFill('hollow');
    setPhotoBuild(product === 'panel' ? panelBuild : sculptureBuild);
  };

  const recordSegmentation = (next: Segmentation) => {
    if (!samePhotoInput(photoSegmentation, next)) {
      photoInputRevisionRef.current += 1;
      setSculptureBuild(null);
      setNaturalSculptureBuild(null);
      setSculpturePalette('natural');
      setApproved3D(null);
      setTrue3DProviderRuns(0);
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

    if (LEGAL_DOCUMENT_SCREENS.has(destination) && !LEGAL_CONTENT_AVAILABLE) {
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
    // The explicit sample-object path intentionally uses the catalogued demo
    // model instead of creating a PhotoModels wrapper. Downstream screens all
    // resolve that same model via resolveActiveModel, so let the buyer finish
    // the complete sample checkout rather than making its CTA silently fail.
    if (needsApprovedBuild && !activeBuild && !sampleUsed) {
      const opensSavedOrderGuide = destination === 'instructions' && !!selectedOrder;
      if (!opensSavedOrderGuide) {
        setTrue3DError('Generate and approve the 3D sculpture before opening its parts or build steps.');
        return;
      }
    }

    if (
      destination !== 'account' &&
      destination !== 'instructions' &&
      !PUBLIC_INFORMATION_SCREENS.has(destination)
    ) {
      setSelectedOrder(null);
    }

    if (
      typeof window !== 'undefined' &&
      (ADDRESSABLE_SCREENS.has(destination) || ADDRESSABLE_SCREENS.has(screen))
    ) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), pixbrikScreen: screen },
        '',
        window.location.href,
      );
      window.history.pushState(
        { pixbrikScreen: destination },
        '',
        locationForScreen(destination),
      );
    }

    setHistory((current) => [...current, screen]);
    setScreen(destination);
  };

  const goBack = () => {
    if (
      typeof window !== 'undefined' &&
      ADDRESSABLE_SCREENS.has(screen) &&
      (screen === 'account'
        ? /^\/account(?:\/|$)/.test(window.location.pathname)
        : window.location.hash === `#${screen}`)
    ) {
      setHistory((current) => current.slice(0, -1));
      window.history.back();
      return;
    }
    const destination = history[history.length - 1] ?? 'home';
    if (destination === 'capture' && panelBuild) {
      setBuildProduct('panel');
      setPhotoBuild(panelBuild);
    }
    setHistory((current) => current.slice(0, -1));
    setScreen(destination);
  };

  const restart = () => {
    clear360Capture();
    clear360ProviderRuns();
    setSampleUsed(false);
    setPhotoUri(null);
    setRightsConfirmedUri(null);
    setPhotoBuild(null);
    setPanelBuild(null);
    setSculptureBuild(null);
    setNaturalSculptureBuild(null);
    setSculpturePalette('natural');
    setApproved3D(null);
    setTrue3DProviderRuns(0);
    setCaptureProviderRunsStart(0);
    setBuildProduct('panel');
    setPhotoSegmentation(null);
    setPending3D(null);
    setTrue3DState('idle');
    setTrue3DNote('');
    setTrue3DError('');
    setSelectedOrder(null);
    setHistory([]);
    setScreen('home');
  };

  const renderScreen = () => {
    const activeBuild = buildProduct === 'panel' ? panelBuild : sculptureBuild;
    switch (screen) {
      case 'legal':
        return (
          <LegalHubScreen
            locale={legalLocale}
            onBack={goBack}
            onLocaleChange={setLegalLocale}
            onNavigate={(destination) => navigate(destination)}
          />
        );
      case 'terms':
        return (
          <TermsScreen
            locale={legalLocale}
            onBack={goBack}
            onLocaleChange={setLegalLocale}
          />
        );
      case 'privacy':
        return (
          <PrivacyScreen
            locale={legalLocale}
            onBack={goBack}
            onLocaleChange={setLegalLocale}
          />
        );
      case 'contact':
        return (
          <ContactScreen
            locale={legalLocale}
            onBack={goBack}
            onLocaleChange={setLegalLocale}
          />
        );
      case 'account':
        return (
          <AccountScreen
            onBack={goBack}
            onOpenBuilds={() => navigate('home')}
            onOpenInstructions={(order) => {
              setSelectedOrder(order);
              // The selected order is React state and does not update until
              // the next render. Navigate directly here so the generic guard
              // cannot read the previous null value and block its own guide.
              setHistory((current) => [...current, screen]);
              setScreen('instructions');
            }}
            selectedOrderId={selectedOrder?.id ?? null}
          />
        );
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
                availableProfiles: ['balanced'],
                hasDepth: restoredAsSculpture ? (saved.hasDepth ?? true) : false,
                label: saved.name,
                mode: restoredAsSculpture ? (saved.mode ?? 'volume') : 'relief',
                models: { balanced: model, detailed: model, efficient: model },
                style: saved.style ?? 'natural',
              };
              setPanelBuild(restoredAsSculpture ? null : restoredBuild);
              setSculptureBuild(restoredAsSculpture ? restoredBuild : null);
              setNaturalSculptureBuild(
                restoredAsSculpture && saved.style !== 'classic' ? restoredBuild : null,
              );
              setSculpturePalette(saved.style === 'classic' ? 'bw' : 'natural');
              setApproved3D(
                restoredAsSculpture && saved.source3DMeshUrl
                  ? {
                      capture: 'saved',
                      meshUrl: saved.source3DMeshUrl,
                      retakesRemaining: saved.source3DRetakesRemaining ?? 0,
                      stills: [],
                    }
                  : null,
              );
              setTrue3DProviderRuns(0);
              setSelectedVariant('balanced');
              setBuildProduct(restoredAsSculpture ? 'sculpture' : 'panel');
              setPhotoBuild(restoredBuild);
              setTrue3DState(restoredAsSculpture ? 'done' : 'idle');
              navigate('result');
            }}
            onOpenLibrary={() => navigate('library')}
            onStart={() => {
              setCaptureProviderRunsStart(0);
              setCaptureMode('photo');
              navigate('capture');
            }}
            onStart3D={() => {
              clear360Capture();
              clear360ProviderRuns();
              setCaptureProviderRunsStart(0);
              setCaptureMode('orbit');
              navigate('capture');
            }}
          />
        );
      case 'mode':
        return (
          <ModeScreen
            full3DAvailable={live3DAvailable}
            onBack={goBack}
            onChange={setCaptureMode}
            onContinue={() => {
              if (captureMode === 'orbit') setCaptureProviderRunsStart(0);
              navigate('capture');
            }}
            value={captureMode}
          />
        );
      case 'capture':
        if (captureMode === 'orbit') {
          return (
            <Capture360Screen
              initialProviderRuns={captureProviderRunsStart}
              onBack={goBack}
              onProviderRunsChange={setCaptureProviderRunsStart}
              onGenerated={(models, frontUri, generated3D) => {
                setPhotoUri(frontUri);
                setPhotoSegmentation(null);
                setSampleUsed(false);
                setPanelBuild(null);
                setNaturalSculptureBuild(models);
                setSculptureBuild(models);
                setSculpturePalette('natural');
                setApproved3D({ capture: 'multiview', ...generated3D });
                setCaptureProviderRunsStart(
                  MAX_TRUE_3D_PROVIDER_RUNS - generated3D.retakesRemaining,
                );
                setTrue3DProviderRuns(0);
                setBuildProduct('sculpture');
                setPhotoBuild(models);
                setPending3D(null);
                setTrue3DState('done');
                saveBuild(models.label, models.models.balanced, colors.blue, {
                  hasDepth: models.hasDepth,
                  mode: models.mode,
                  product: 'sculpture',
                  provenance: 'provider-3d',
                  source3DMeshUrl: generated3D.meshUrl,
                  source3DRetakesRemaining: generated3D.retakesRemaining,
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
              setNaturalSculptureBuild(null);
              setSculpturePalette('natural');
              setApproved3D(null);
              setTrue3DProviderRuns(0);
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
              setNaturalSculptureBuild(null);
              setSculpturePalette('natural');
              setApproved3D(null);
              setTrue3DProviderRuns(0);
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
            onBack={goBack}
            onContinue={() => {
              setSelectedVariant(variantForPreferences(size));
              navigate('result');
            }}
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
            buildFill={buildFill}
            onBuildFillChange={setBuildFill}
            activeProduct={buildProduct}
            panelBuild={panelBuild}
            sculptureBuild={sculptureBuild}
            onSelectProduct={selectBuildProduct}
            onGuided3D={() => {
              clear360Capture();
              clear360ProviderRuns();
              setCaptureProviderRunsStart(0);
              setCaptureMode('orbit');
              navigate('capture');
            }}
            approved3DMeshUrl={approved3D?.meshUrl ?? null}
            approved3DStills={approved3D?.stills ?? null}
            sculpturePalette={sculpturePalette}
            onSelectSculpturePalette={naturalSculptureBuild ? selectSculpturePalette : undefined}
            onRetake3D={
              approved3D?.capture === 'library' || approved3D?.capture === 'saved'
                ? undefined
                : () => {
                    if (approved3D?.capture === 'multiview') {
                      setCaptureMode('orbit');
                      navigate('capture');
                      return;
                    }
                    void rebuildTrue3D();
                  }
            }
            onTrue3D={rebuildTrue3D}
            onApprove3D={approve3D}
            onRetry3DPreview={retry3DPreview}
            onDiscard3D={() => {
              setPending3D(null);
              setTrue3DState('idle');
            }}
            pending3DMeshUrl={pending3D?.meshUrl ?? null}
            pending3DStills={pending3D?.stills ?? null}
            photoBuild={activeBuild}
            photoUri={photoUri}
            humanSubject={humanSubjectRequiresGuided3D}
            selectedVariant={selectedVariant}
            true3DState={true3DState}
            true3DNote={true3DNote}
            true3DError={true3DError}
            true3DRetakesRemaining={
              pending3D || approved3D?.capture === 'single'
                ? true3DProviderRuns === 0
                  ? 2
                  : Math.max(0, MAX_TRUE_3D_PROVIDER_RUNS - true3DProviderRuns)
                : approved3D?.capture === 'multiview'
                  ? Math.max(0, MAX_TRUE_3D_PROVIDER_RUNS - captureProviderRunsStart)
                : approved3D?.retakesRemaining ??
                  (true3DProviderRuns === 0
                    ? 2
                    : Math.max(0, MAX_TRUE_3D_PROVIDER_RUNS - true3DProviderRuns))
            }
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
            generationProgress={libraryGenerationProgress}
            generating={libraryGenerating}
            onBack={goBack}
            onGenerate={generateFromLibrary}
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
      case 'checkout':
        return (
          <CheckoutScreen
            buildFill={buildFill}
            buildName={
              activeBuild
                ? activeBuild.label.charAt(0).toUpperCase() + activeBuild.label.slice(1)
                : sampleUsed
                  ? 'Signal Fox'
                  : 'PixBrik build'
            }
            buildProduct={buildProduct}
            countryCode={countryCode}
            onBack={goBack}
            onDone={restart}
            onOrderPlaced={(order) => {
              setSelectedOrder(order);
              navigate('account');
            }}
            paletteMode={
              buildProduct === 'sculpture' && sculpturePalette === 'bw'
                ? 'black-white'
                : 'natural'
            }
            photoBuild={activeBuild}
            selectedVariant={selectedVariant}
            source3DMeshUrl={approved3D?.meshUrl ?? null}
            source3DRetakesRemaining={approved3D?.retakesRemaining ?? 0}
          />
        );
      case 'instructions':
        if (sharedGuide) {
          return (
            <InstructionsScreen
              accent={sharedGuide.build.accent}
              buildName={sharedGuide.build.name}
              bomOverride={sharedGuide.build.bom}
              model={loadGuideModel(sharedGuide)}
              onBack={() => setScreen('home')}
              onNavigate={navigate}
              onRestart={restart}
              placementOrder={sharedGuide.manual.placementOrder}
              profile={sharedGuide.build.profile}
              publishedGuideUrl={
                typeof window === 'undefined' ? undefined : window.location.href
              }
            />
          );
        }
        if (sharedGuideId) {
          return (
            <SharedGuideLoadingScreen
              error={sharedGuideError || undefined}
              onBack={() => setScreen('home')}
            />
          );
        }
        if (selectedOrder) {
          return (
            <InstructionsScreen
              accent={selectedOrder.accent}
              buildName={selectedOrder.buildName}
              bomOverride={selectedOrder.bom}
              model={loadOrderModel(selectedOrder.model)}
              onBack={goBack}
              onNavigate={navigate}
              onRestart={restart}
              orderId={selectedOrder.id}
              profile={selectedOrder.profile}
            />
          );
        }
        if (activeBuild || sampleUsed) {
          const activeModel = resolveActiveModel(activeBuild, selectedVariant);
          return (
            <InstructionsScreen
              accent={accentForVariant(selectedVariant)}
              buildName={
                activeBuild
                  ? activeBuild.label.charAt(0).toUpperCase() + activeBuild.label.slice(1)
                  : 'Signal Fox'
              }
              model={buildFill === 'hollow' ? hollowBuildModel(activeModel) : activeModel}
              onBack={goBack}
              onNavigate={navigate}
              onRestart={restart}
              profile={profileForVariant(selectedVariant)}
            />
          );
        }
        return null;
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

export default function App() {
  return (
    <PixBrikAuthProvider>
      <PixBrikApp />
    </PixBrikAuthProvider>
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
