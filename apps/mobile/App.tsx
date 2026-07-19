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
import { CaptureScreen, type SculptureSubjectKind } from './src/screens/CaptureScreen';
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
import { loadModel, saveBuild, updateBuild } from './src/lib/buildGallery';
import { accentForVariant, profileForVariant, resolveActiveModel } from './src/lib/activeBuild';
import { clear360Capture, clear360ProviderRuns } from './src/lib/capture360Store';
import { clearLastCapture } from './src/lib/captureStore';
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
  isLive3DConfigured,
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
const DEMO_SCREENS = new Set<DemoScreen>([
  'home', 'account', 'legal', 'terms', 'privacy', 'contact', 'mode', 'capture',
  'preferences', 'progress', 'result', 'bom', 'purchase', 'stores', 'checkout',
  'library', 'lab', 'instructions',
]);
const LEGAL_LOCALES = new Set<LegalLocale>(['en', 'fr', 'es', 'it', 'ar']);
const LEGAL_LOCALE_STORAGE_KEY = 'pixbrik.legal-locale';

function isDemoScreen(value: unknown): value is DemoScreen {
  return typeof value === 'string' && DEMO_SCREENS.has(value as DemoScreen);
}

function browserHistoryFromState(value: unknown): DemoScreen[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDemoScreen);
}

function legalScreenFromLocation(): DemoScreen | null {
  if (typeof window === 'undefined') return null;
  const pathCandidate = window.location.pathname.replace(/^\/+|\/+$/g, '') as DemoScreen;
  const candidate = (
    PUBLIC_INFORMATION_SCREENS.has(pathCandidate)
      ? pathCandidate
      : window.location.hash.replace(/^#/, '')
  ) as DemoScreen;
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
  if (PUBLIC_INFORMATION_SCREENS.has(screen)) return `/${screen}${search}`;
  return `/${search}`;
}

function locationMatchesScreen(screen: DemoScreen): boolean {
  if (typeof window === 'undefined') return false;
  if (screen === 'account') return /^\/account(?:\/|$)/.test(window.location.pathname);
  if (!PUBLIC_INFORMATION_SCREENS.has(screen)) return false;
  return (
    window.location.pathname.replace(/^\/+|\/+$/g, '') === screen ||
    window.location.hash === `#${screen}`
  );
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
  /** Drives truthful result copy and person-safe kit sizing after capture unmounts. */
  subject: SculptureSubjectKind;
}

interface SavedBuildIdentity {
  id: string | null;
  name: string;
}

function initialBuildName(value: string, fallback = 'PixBrik build'): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : fallback;
}

function PixBrikApp() {
  const live3DAvailable = Platform.OS === 'web' && isLive3DConfigured();
  const [fontsLoaded] = useFonts({
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    ArchivoBlack_400Regular,
  });
  const [screen, setScreen] = useState<DemoScreen>(initialScreen);
  const [history, setHistory] = useState<DemoScreen[]>([]);
  const screenRef = useRef(screen);
  const navigationLockedRef = useRef(false);
  screenRef.current = screen;
  const [legalLocale, setLegalLocale] = useState<LegalLocale>(initialLegalLocale);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('photo');
  const [captureTarget, setCaptureTarget] = useState<BuildProduct>('panel');
  const [captureSubjectKind, setCaptureSubjectKind] = useState<SculptureSubjectKind | null>(null);
  const [guidedCaptureSubject, setGuidedCaptureSubject] = useState<SculptureSubjectKind>('object');
  const [capture360ReturnsToSubjectChoice, setCapture360ReturnsToSubjectChoice] = useState(false);
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
  const [activeSavedBuildId, setActiveSavedBuildId] = useState<string | null>(null);
  const [buildName, setBuildName] = useState('PixBrik build');
  const savedBuildIdentitiesRef = useRef<Partial<Record<BuildProduct, SavedBuildIdentity>>>({});
  const [countryCode, setCountryCode] = useState('FR');
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [sharedGuideId, setSharedGuideId] = useState<string | null>(initialGuideId);
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
  const instructionsAvailableRef = useRef(false);
  instructionsAvailableRef.current = !!(
    sharedGuideId ||
    sharedGuide ||
    selectedOrder ||
    sampleUsed ||
    (buildProduct === 'panel' ? panelBuild : sculptureBuild)
  );
  /** Changes whenever the exact crop/matte input changes, even on the same URI. */
  const photoInputRevisionRef = useRef(0);
  const [libraryGenerating, setLibraryGenerating] = useState(false);
  const [libraryGenerationProgress, setLibraryGenerationProgress] = useState(0);
  const [libraryGenerationError, setLibraryGenerationError] = useState('');

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

  const activateSavedBuild = (product: BuildProduct, identity: SavedBuildIdentity) => {
    savedBuildIdentitiesRef.current = {
      ...savedBuildIdentitiesRef.current,
      [product]: identity,
    };
    setActiveSavedBuildId(identity.id);
    setBuildName(identity.name);
  };

  const resetSavedBuildIdentity = () => {
    savedBuildIdentitiesRef.current = {};
    setActiveSavedBuildId(null);
    setBuildName('PixBrik build');
  };

  const changeActiveBuildName = (name: string) => {
    setBuildName(name);
    const identity = savedBuildIdentitiesRef.current[buildProduct];
    if (identity?.id === activeSavedBuildId) {
      savedBuildIdentitiesRef.current = {
        ...savedBuildIdentitiesRef.current,
        [buildProduct]: { ...identity, name },
      };
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(
      { ...(window.history.state ?? {}), pixbrikHistory: history, pixbrikScreen: screen },
      '',
      window.location.href,
    );
    const onPopState = (event: PopStateEvent) => {
      if (navigationLockedRef.current) {
        window.history.forward();
        return;
      }
      const entry = event.state as {
        pixbrikHistory?: unknown;
        pixbrikScreen?: unknown;
      } | null;
      const stateScreen = entry?.pixbrikScreen;
      let destination =
        isDemoScreen(stateScreen)
          ? stateScreen
          : accountScreenFromLocation() ?? legalScreenFromLocation() ?? 'home';
      if (destination === 'instructions' && !instructionsAvailableRef.current) {
        destination = 'home';
        window.history.replaceState(
          { ...(window.history.state ?? {}), pixbrikHistory: [], pixbrikScreen: 'home' },
          '',
          locationForScreen('home'),
        );
      }
      setHistory(browserHistoryFromState(entry?.pixbrikHistory));
      setScreen(destination);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!navigationLockedRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const selectSculpturePalette = (style: MeshBrickColorStyle) => {
    if (!naturalSculptureBuild) return;
    const recolored = recolorPhotoModels(naturalSculptureBuild, style);
    setSculpturePalette(style);
    setSculptureBuild(recolored);
    if (buildProduct === 'sculpture') setPhotoBuild(recolored);
  };

  const generateFromLibrary = async (
    entry: LibraryEntry,
    colorHex: string,
    options?: import('./src/lib/proceduralLibrary').LibraryBuildOptions,
  ) => {
    setLibraryGenerationError('');
    if (!entry.meshUrl && !entry.proceduralKey) {
      setLibraryGenerationError('This object is not ready to build yet. Choose another object and try again.');
      return;
    }
    setLibraryGenerating(true);
    navigationLockedRef.current = true;
    setLibraryGenerationProgress(0);
    try {
      const models = entry.proceduralKey
        ? await (await import('./src/lib/proceduralLibrary')).buildProceduralLibraryEntry(
            entry, colorHex, options, setLibraryGenerationProgress,
          )
        : await (await import('./src/lib/photoEngine/imageTo3D')).buildFromLibrary(
            entry.meshUrl!, entry.name, colorHex, setLibraryGenerationProgress,
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
        // Procedural builds already own their exact voxel geometry; there is
        // no source GLB to load in the raw-mesh viewer.
        meshUrl: entry.meshUrl ?? '',
        retakesRemaining: 0,
        stills: [],
        subject: 'object',
      });
      setCaptureSubjectKind('object');
      setGuidedCaptureSubject('object');
      setTrue3DProviderRuns(0);
      setBuildProduct('sculpture');
      setBuildFill('hollow');
      setPhotoBuild(models);
      const libraryProfile = options?.size ?? 'balanced';
      setSelectedVariant(
        libraryProfile === 'efficient' ? 'easy' : libraryProfile === 'detailed' ? 'detail' : 'balanced',
      );
      const savedName = initialBuildName(entry.name);
      const saved = saveBuild(savedName, models.models[libraryProfile], colorHex, {
        hasDepth: models.hasDepth,
        mode: models.mode,
        product: 'sculpture',
        provenance: 'library',
        source3DMeshUrl: entry.meshUrl ?? undefined,
        source3DRetakesRemaining: 0,
        source3DSubject: 'object',
        style: models.style,
      });
      savedBuildIdentitiesRef.current = {};
      activateSavedBuild('sculpture', { id: saved?.id ?? null, name: savedName });
      navigationLockedRef.current = false;
      navigate('result');
    } catch (error) {
      console.error('[library] build failed:', error);
      const detail = error instanceof Error ? error.message.replace(/\s+/g, ' ').trim() : '';
      setLibraryGenerationError(
        detail
          ? `We couldn't create this build. ${detail}`
          : "We couldn't create this build. Please try again.",
      );
    } finally {
      navigationLockedRef.current = false;
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
    if (Platform.OS !== 'web') {
      setTrue3DError('True 3D generation currently requires pixbrik.com in a web browser. No provider task was started.');
      setTrue3DState('failed');
      return;
    }
    if (humanSubjectRequiresGuided3D || captureSubjectKind === 'person') {
      setBuildProduct('sculpture');
      setTrue3DError('People need front, left, back and right photos for True 3D.');
      setCaptureProviderRunsStart(0);
      setGuidedCaptureSubject('person');
      setCaptureTarget('sculpture');
      setCapture360ReturnsToSubjectChoice(false);
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
    navigationLockedRef.current = true;
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
      navigationLockedRef.current = false;
      true3DRequestRef.current = false;
    }
  };

  /** Re-render approval stills from the existing mesh without another paid provider task. */
  const retry3DPreview = async () => {
    if (!pending3D || true3DRequestRef.current) return;
    const { meshUrl, sourceRevision, sourceUri } = pending3D;
    true3DRequestRef.current = true;
    navigationLockedRef.current = true;
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
      navigationLockedRef.current = false;
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
    navigationLockedRef.current = true;
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
        subject: 'object',
      });
      setBuildProduct('sculpture');
      setBuildFill('hollow');
      setPhotoBuild(models);
      const savedName = initialBuildName(buildName, initialBuildName(models.label));
      const saved = saveBuild(savedName, models.models.balanced, colors.blue, {
        hasDepth: models.hasDepth,
        mode: models.mode,
        product: 'sculpture',
        provenance: 'provider-3d',
        source3DMeshUrl: meshUrl,
        source3DRetakesRemaining: Math.max(0, MAX_TRUE_3D_PROVIDER_RUNS - true3DProviderRuns),
        source3DSubject: 'object',
        style: models.style,
      });
      activateSavedBuild('sculpture', { id: saved?.id ?? null, name: savedName });
      setTrue3DState('done');
    } catch (error) {
      // Keep the already-paid mesh available so a local conversion retry does
      // not force the buyer to purchase another provider generation.
      setPending3D(pending3D);
      setTrue3DError(error instanceof Error ? error.message : 'Brick conversion failed.');
      setTrue3DState('failed');
    } finally {
      navigationLockedRef.current = false;
      true3DRequestRef.current = false;
    }
  };

  const selectBuildProduct = (product: BuildProduct) => {
    setBuildProduct(product);
    if (product === 'panel') setBuildFill('hollow');
    const nextBuild = product === 'panel' ? panelBuild : sculptureBuild;
    setPhotoBuild(nextBuild);
    const identity = savedBuildIdentitiesRef.current[product];
    setActiveSavedBuildId(identity?.id ?? null);
    setBuildName(
      identity?.name ??
        (nextBuild ? initialBuildName(nextBuild.label) : sampleUsed ? 'Signal Fox' : buildName),
    );
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

  const navigate = (destination: DemoScreen, orderForInstructions: OrderRecord | null = selectedOrder) => {
    if (navigationLockedRef.current) return;
    if (destination === screen) {
      return;
    }

    if (LEGAL_DOCUMENT_SCREENS.has(destination) && !LEGAL_CONTENT_AVAILABLE) {
      return;
    }

    const leavesSharedGuide =
      !!sharedGuideId &&
      destination !== 'instructions' &&
      destination !== 'account' &&
      !PUBLIC_INFORMATION_SCREENS.has(destination);
    const leavesStoredOrderGuide =
      screen === 'instructions' &&
      !!selectedOrder &&
      destination !== 'instructions' &&
      destination !== 'account' &&
      !PUBLIC_INFORMATION_SCREENS.has(destination);
    if (leavesSharedGuide || leavesStoredOrderGuide) {
      // Global chrome is still available inside frozen guides. Starting a new
      // buyer journey must retire that read-only context (and a shared guide's
      // `/g/:id` URL), otherwise Back can reopen an empty or stale manual.
      setSharedGuideId(null);
      setSharedGuide(null);
      setSharedGuideError('');
      setSelectedOrder(null);
      setHistory(destination === 'home' ? [] : ['home']);
      setScreen(destination);
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          {
            ...(window.history.state ?? {}),
            pixbrikHistory: destination === 'home' ? [] : ['home'],
            pixbrikScreen: destination,
          },
          '',
          locationForScreen(destination),
        );
      }
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
      const opensSavedOrderGuide = destination === 'instructions' && !!orderForInstructions;
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
        { ...(window.history.state ?? {}), pixbrikHistory: history, pixbrikScreen: screen },
        '',
        window.location.href,
      );
      window.history.pushState(
        { pixbrikHistory: [...history, screen], pixbrikScreen: destination },
        '',
        locationForScreen(destination),
      );
    }

    setHistory((current) => [...current, screen]);
    setScreen(destination);
  };

  const goBack = () => {
    if (navigationLockedRef.current) return;
    const destination = history[history.length - 1] ?? 'home';
    if (
      typeof window !== 'undefined' &&
      history.length > 0 &&
      (window.history.state as { pixbrikScreen?: unknown } | null)?.pixbrikScreen === screen &&
      (ADDRESSABLE_SCREENS.has(screen) || ADDRESSABLE_SCREENS.has(destination))
    ) {
      // popstate owns the in-app history update; trimming here as well would
      // discard two screens for one browser Back action. This also covers an
      // order guide at `/` returning to its `/account` browser entry.
      window.history.back();
      return;
    }
    if (
      typeof window !== 'undefined' &&
      ADDRESSABLE_SCREENS.has(screen) &&
      locationMatchesScreen(screen)
    ) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), pixbrikHistory: [], pixbrikScreen: 'home' },
        '',
        locationForScreen('home'),
      );
      setScreen('home');
      return;
    }
    if (destination === 'capture' && panelBuild) {
      setBuildProduct('panel');
      setBuildFill('hollow');
      setPhotoBuild(panelBuild);
    }
    setHistory((current) => current.slice(0, -1));
    setScreen(destination);
  };

  const restart = () => {
    clear360Capture();
    clear360ProviderRuns();
    clearLastCapture();
    resetSavedBuildIdentity();
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
    setCaptureTarget('panel');
    setCaptureSubjectKind(null);
    setGuidedCaptureSubject('object');
    setCapture360ReturnsToSubjectChoice(false);
    setBuildProduct('panel');
    setBuildFill('hollow');
    setPhotoSegmentation(null);
    setPending3D(null);
    setTrue3DState('idle');
    setTrue3DNote('');
    setTrue3DError('');
    setSelectedOrder(null);
    setSharedGuideId(null);
    setSharedGuide(null);
    setSharedGuideError('');
    setHistory([]);
    setScreen('home');
    if (typeof window !== 'undefined' && readGuideShareId(window.location.href)) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), pixbrikHistory: [], pixbrikScreen: 'home' },
        '',
        locationForScreen('home'),
      );
    }
  };

  const exitSharedGuide = () => {
    setSharedGuideId(null);
    setSharedGuide(null);
    setSharedGuideError('');
    setSelectedOrder(null);
    setHistory([]);
    setScreen('home');
    if (typeof window !== 'undefined') {
      window.history.replaceState(
        { ...(window.history.state ?? {}), pixbrikHistory: [], pixbrikScreen: 'home' },
        '',
        locationForScreen('home'),
      );
    }
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
              // A buyer can reach Account from a shared QR guide. Choosing a
              // stored order must replace that guide rather than letting the
              // shared snapshot keep priority in the instructions renderer.
              setSharedGuideId(null);
              setSharedGuide(null);
              setSharedGuideError('');
              setSelectedOrder(order);
              // Pass the selected record through the guard synchronously so
              // this transition still receives a real browser-history entry.
              navigate('instructions', order);
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
              const restoredSubject = saved.source3DSubject ?? 'object';
              setCaptureSubjectKind(restoredAsSculpture ? restoredSubject : null);
              setGuidedCaptureSubject(restoredSubject);
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
                      subject: restoredSubject,
                    }
                  : null,
              );
              setTrue3DProviderRuns(0);
              setSelectedVariant('balanced');
              setBuildProduct(restoredAsSculpture ? 'sculpture' : 'panel');
              setBuildFill('hollow');
              setPhotoBuild(restoredBuild);
              savedBuildIdentitiesRef.current = {};
              activateSavedBuild(restoredAsSculpture ? 'sculpture' : 'panel', {
                id: saved.id,
                name: saved.name,
              });
              setTrue3DState(restoredAsSculpture ? 'done' : 'idle');
              navigate('result');
            }}
            onOpenLibrary={() => navigate('library')}
            onStart={() => {
              setCaptureProviderRunsStart(0);
              setBuildFill('hollow');
              setCaptureTarget('panel');
              setCaptureSubjectKind(null);
              setGuidedCaptureSubject('object');
              setCapture360ReturnsToSubjectChoice(false);
              setCaptureMode('photo');
              navigate('capture');
            }}
            onStart3D={() => {
              setCaptureProviderRunsStart(0);
              setBuildFill('hollow');
              setCaptureTarget('sculpture');
              setCaptureSubjectKind(null);
              setGuidedCaptureSubject('object');
              setCapture360ReturnsToSubjectChoice(false);
              setCaptureMode('photo');
              navigate('capture');
            }}
          />
        );
      case 'mode':
        return (
          <ModeScreen
            full3DAvailable={live3DAvailable}
            onBack={goBack}
            onChange={(nextMode) => {
              setCaptureMode(nextMode);
              setCaptureTarget(nextMode === 'orbit' ? 'sculpture' : 'panel');
              if (nextMode !== 'orbit') setBuildFill('hollow');
            }}
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
              onNavigationLockChange={(locked) => {
                navigationLockedRef.current = locked;
              }}
              onBack={() => {
                if (capture360ReturnsToSubjectChoice) {
                  // Choosing Person happens inside the capture screen, so it
                  // does not create a separate navigation entry. Return to
                  // that explicit Object/Person choice instead of skipping
                  // the buyer all the way back to Home.
                  setCapture360ReturnsToSubjectChoice(false);
                  setCaptureMode('photo');
                  return;
                }
                goBack();
              }}
              onProviderRunsChange={setCaptureProviderRunsStart}
              onGenerated={(models, frontUri, generated3D) => {
                navigationLockedRef.current = false;
                setPhotoUri(frontUri);
                setPhotoSegmentation(null);
                setSampleUsed(false);
                setPanelBuild(null);
                setNaturalSculptureBuild(models);
                setSculptureBuild(models);
                setSculpturePalette('natural');
                setApproved3D({
                  capture: 'multiview',
                  subject: guidedCaptureSubject,
                  ...generated3D,
                });
                setCaptureProviderRunsStart(
                  MAX_TRUE_3D_PROVIDER_RUNS - generated3D.retakesRemaining,
                );
                setTrue3DProviderRuns(0);
                setBuildProduct('sculpture');
                setBuildFill('hollow');
                setPhotoBuild(models);
                setPending3D(null);
                setTrue3DState('done');
                const savedName = initialBuildName(models.label);
                const saved = saveBuild(savedName, models.models.balanced, colors.blue, {
                  hasDepth: models.hasDepth,
                  mode: models.mode,
                  product: 'sculpture',
                  provenance: 'provider-3d',
                  source3DMeshUrl: generated3D.meshUrl,
                  source3DRetakesRemaining: generated3D.retakesRemaining,
                  source3DSubject: guidedCaptureSubject,
                  style: models.style,
                });
                savedBuildIdentitiesRef.current = {};
                activateSavedBuild('sculpture', { id: saved?.id ?? null, name: savedName });
                navigate('result');
              }}
            />
          );
        }
        return (
          <CaptureScreen
            captured={captured}
            mode={captureMode}
            targetProduct={captureTarget}
            sculptureSubjectKind={captureSubjectKind}
            onSculptureSubjectKindChange={setCaptureSubjectKind}
            onNavigationLockChange={(locked) => {
              navigationLockedRef.current = locked;
            }}
            onBack={goBack}
            onContinue={() => {
              setSelectedVariant('balanced');
              navigate('result');
            }}
            onObjectLocked={(models) => {
              setPanelBuild(models);
              setBuildProduct(captureTarget);
              setBuildFill('hollow');
              setPhotoBuild(models);
              const existingIdentity = savedBuildIdentitiesRef.current[captureTarget];
              const savedName = existingIdentity?.name ?? initialBuildName(models.label);
              const metadata = {
                hasDepth: models.hasDepth,
                mode: models.mode,
                product: 'panel',
                provenance: 'flat-photo',
                style: models.style,
              } as const;
              const saved = existingIdentity?.id
                ? updateBuild(
                    existingIdentity.id,
                    savedName,
                    models.models.balanced,
                    colors.blue,
                    metadata,
                  )
                : saveBuild(savedName, models.models.balanced, colors.blue, metadata);
              activateSavedBuild('panel', { id: saved?.id ?? null, name: savedName });
            }}
            onPhotoChange={(uri) => {
              resetSavedBuildIdentity();
              photoInputRevisionRef.current += 1;
              setPhotoUri(uri);
              setPhotoBuild(null);
              setPanelBuild(null);
              setSculptureBuild(null);
              setNaturalSculptureBuild(null);
              setSculpturePalette('natural');
              setApproved3D(null);
              setTrue3DProviderRuns(0);
              setBuildProduct(captureTarget);
              setBuildFill('hollow');
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
            onGuided3D={(subjectKind) => {
              clear360Capture();
              clear360ProviderRuns();
              setCaptureProviderRunsStart(0);
              setGuidedCaptureSubject(subjectKind);
              setCaptureSubjectKind(subjectKind);
              setCaptureTarget('sculpture');
              setCapture360ReturnsToSubjectChoice(true);
              setCaptureMode('orbit');
            }}
            onSegmentation={recordSegmentation}
            onUseSample={() => {
              resetSavedBuildIdentity();
              setCaptureSubjectKind(null);
              setGuidedCaptureSubject('object');
              setPhotoUri(null);
              setPhotoBuild(null);
              setPanelBuild(null);
              setSculptureBuild(null);
              setNaturalSculptureBuild(null);
              setSculpturePalette('natural');
              setApproved3D(null);
              setTrue3DProviderRuns(0);
              setBuildProduct('panel');
              setBuildFill('hollow');
              setPhotoSegmentation(null);
              setRightsConfirmedUri(null);
              setPending3D(null);
              setTrue3DState('idle');
              setTrue3DNote('');
              setTrue3DError('');
              setSampleUsed(true);
              activateSavedBuild('panel', { id: null, name: 'Signal Fox' });
            }}
            photoBuild={captureTarget === 'sculpture' ? panelBuild : activeBuild}
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
            activeSavedBuildId={activeSavedBuildId}
            buildName={buildName}
            onBack={goBack}
            onBuildNameChange={changeActiveBuildName}
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
              const subjectKind: SculptureSubjectKind =
                humanSubjectRequiresGuided3D || approved3D?.subject === 'person'
                  ? 'person'
                  : 'object';
              setGuidedCaptureSubject(subjectKind);
              setCaptureSubjectKind(subjectKind);
              setCaptureTarget('sculpture');
              setCapture360ReturnsToSubjectChoice(false);
              setCaptureMode('orbit');
              navigate('capture');
            }}
            onNavigationLockChange={(locked) => {
              navigationLockedRef.current = locked;
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
                      setGuidedCaptureSubject(approved3D.subject);
                      setCaptureSubjectKind(approved3D.subject);
                      setCaptureTarget('sculpture');
                      setCapture360ReturnsToSubjectChoice(false);
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
            humanSubject={
              humanSubjectRequiresGuided3D || approved3D?.subject === 'person'
            }
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
            generationError={libraryGenerationError}
            generationProgress={libraryGenerationProgress}
            generating={libraryGenerating}
            onBack={goBack}
            onClearGenerationError={() => setLibraryGenerationError('')}
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
            buildId={activeSavedBuildId}
            buildFill={buildFill}
            buildName={buildName}
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
              onBack={exitSharedGuide}
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
              onBack={exitSharedGuide}
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
              buildFill={buildFill}
              buildName={buildName}
              model={activeModel}
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
