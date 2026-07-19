import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Polygon, Rect } from 'react-native-svg';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenFrame } from '../components/ScreenFrame';
import {
  LIBRARY_CATEGORIES, LIBRARY_COLORS, type LibraryEntry, type MessageFont,
} from '../data/carLibrary';
import { SCULPTURE_SIZE_OPTIONS } from '../lib/kitSizing';
import { listLibrary, loadLibrary } from '../lib/libraryStore';
import {
  buildProceduralLibraryPreview, isLibraryEntryReleased, releasedProceduralLibraryProfiles,
  sanitiseMessage, type LibraryBuildOptions, type MessageHolder,
} from '../lib/proceduralLibrary';
import { buildRenderFaces, type Projection, type RenderFace } from '../lib/voxelRender';
import type { BuildProfile } from '../lib/voxelFox';
import { colors, radius, spacing, type } from '../theme/tokens';

interface LibraryScreenProps {
  onBack: () => void;
  onGenerate: (entry: LibraryEntry, colorHex: string, options?: LibraryBuildOptions) => Promise<void>;
  onClearGenerationError: () => void;
  generating: boolean;
  generationError?: string;
  generationProgress?: number;
}

type SortMode = 'featured' | 'az' | 'za' | 'category';
const PAGE_SIZE = 8;
const MESSAGE_ENTRY: LibraryEntry = {
  category: 'object', defaultColor: '#D7263D', icon: 'Aa', id: 'custom-message', meshUrl: null,
  name: 'Custom Message', proceduralKey: 'custom-message', supportsHolder: true, tags: ['personalise'],
};
const FONT_LABELS: Record<MessageFont, string> = { block: 'Block', rounded: 'Soft', stencil: 'Stencil' };
const HOLDER_LABELS: Record<MessageHolder, string> = { freestanding: 'Display stand', wall: 'Wall hanging', flat: 'Flat letters' };
const SORTS: { id: SortMode; label: string }[] = [
  { id: 'featured', label: 'Featured' }, { id: 'az', label: 'A-Z' },
  { id: 'za', label: 'Z-A' }, { id: 'category', label: 'Category' },
];
const searchKey=(value:string)=>value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/['’]s\b/gi,'')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,' ')
  .trim();

function fitFaces(faces: RenderFace[]): Projection {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const face of faces)for(const pair of face.points.split(' ')){
    const [x,y]=pair.split(',').map(Number); if(x===undefined||y===undefined)continue;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  const scale=Math.min(112/Math.max(1,maxX-minX),82/Math.max(1,maxY-minY));
  return {baseY:56-((minY+maxY)/2)*scale,centerX:70-((minX+maxX)/2)*scale,scale};
}

function BrickThumbnail({ entry, color, options }: { entry: LibraryEntry; color: string; options?: LibraryBuildOptions }) {
  const faces=useMemo(()=>{
    if(!entry.proceduralKey)return [];
    const model=buildProceduralLibraryPreview(entry,color,options);
    const probe=buildRenderFaces(.55,color,model,{baseY:0,centerX:0,scale:1});
    return buildRenderFaces(.55,color,model,fitFaces(probe));
  },[
    color,
    entry,
    options?.flowerColors,
    options?.flowerCount,
    options?.font,
    options?.holder,
    options?.message,
    options?.size,
  ]);
  if(entry.thumbnailUrl)return <Image accessibilityLabel={`${entry.name} realistic 3D preview`} resizeMode="contain" source={{uri:entry.thumbnailUrl}} style={styles.thumbnailImage}/>;
  if(entry.meshUrl)return <View style={styles.meshPlaceholder}><Text style={styles.meshPlaceholderText}>REAL 3D</Text></View>;
  return <Svg height="100%" viewBox="0 0 140 104" width="100%"><Rect fill="#F5F2EA" height="104" width="140"/>{faces.map(face=><Polygon fill={face.fill} key={face.id} points={face.points} stroke="#17130A" strokeWidth=".35"/>)}</Svg>;
}

export function LibraryScreen({
  onBack,
  onGenerate,
  onClearGenerationError,
  generating,
  generationError='',
  generationProgress=0,
}: LibraryScreenProps) {
  const [entries,setEntries]=useState<LibraryEntry[]>(()=>listLibrary());
  const [catalogNotice,setCatalogNotice]=useState('');
  const [category,setCategory]=useState('all');
  const [query,setQuery]=useState('');
  const [sort,setSort]=useState<SortMode>('featured');
  const [page,setPage]=useState(1);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [color,setColor]=useState<string|null>(null);
  const [size,setSize]=useState<BuildProfile>('balanced');
  const [message,setMessage]=useState('HELLO');
  const [font,setFont]=useState<MessageFont>('block');
  const [holder,setHolder]=useState<MessageHolder>('freestanding');
  const [flowerCount,setFlowerCount]=useState<1|3|5>(5);
  const [flowerColors,setFlowerColors]=useState(['#B51F3A','#F05A7E','#F4C430','#A64AC9','#F4F1E8']);
  const [activeFlower,setActiveFlower]=useState(0);

  useEffect(()=>{
    let cancelled=false;
    void loadLibrary()
      .then((published)=>{if(!cancelled){setEntries(published);setCatalogNotice('');}})
      .catch(()=>{if(!cancelled)setCatalogNotice('Showing customizable signs while the production catalogue reconnects.');});
    return()=>{cancelled=true;};
  },[]);

  const selected=selectedId===MESSAGE_ENTRY.id?MESSAGE_ENTRY:entries.find(entry=>entry.id===selectedId)??null;
  const releasedSizes=useMemo(()=>selected?releasedProceduralLibraryProfiles(selected):[],[selected]);
  const buildColor=color??selected?.defaultColor??LIBRARY_COLORS[0]!;
  const customOptions=useMemo<LibraryBuildOptions>(()=>({flowerColors,flowerCount,font,holder,message:sanitiseMessage(message),size}),[flowerColors,flowerCount,font,holder,message,size]);
  const filtered=useMemo(()=>{
    const needle=searchKey(query);
    const result=entries.filter(entry=>{
      const inCategory=category==='all'||entry.category===category||entry.theme===category;
      const haystack=searchKey([entry.name,entry.category,entry.theme,entry.presetMessage,...entry.tags].filter(Boolean).join(' '));
      return inCategory&&(!needle||haystack.includes(needle));
    });
    if(sort==='az')return [...result].sort((a,b)=>a.name.localeCompare(b.name));
    if(sort==='za')return [...result].sort((a,b)=>b.name.localeCompare(a.name));
    if(sort==='category')return [...result].sort((a,b)=>`${a.category}-${a.name}`.localeCompare(`${b.category}-${b.name}`));
    return result;
  },[category,entries,query,sort]);
  const pageCount=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const visible=filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  useEffect(()=>setPage(1),[category,query,sort]);
  useEffect(()=>{if(page>pageCount)setPage(pageCount);},[page,pageCount]);
  useEffect(()=>{
    if(selectedId===MESSAGE_ENTRY.id&&category!=='message'){setSelectedId(null);return;}
    if(selectedId&&category!=='message'&&!filtered.some(entry=>entry.id===selectedId))setSelectedId(null);
  },[category,filtered,selectedId]);
  useEffect(()=>{
    if(releasedSizes.length&&!releasedSizes.includes(size))setSize(releasedSizes[0]!);
  },[releasedSizes,size]);
  useEffect(()=>{
    if(activeFlower>=flowerCount)setActiveFlower(flowerCount-1);
  },[activeFlower,flowerCount]);

  const select=(entry:LibraryEntry)=>{
    onClearGenerationError();
    setSelectedId(entry.id);setColor(entry.defaultColor);
    const profiles=releasedProceduralLibraryProfiles(entry);
    setSize(profiles.includes('balanced')?'balanced':profiles[0]??'efficient');
    if(entry.presetMessage)setMessage(entry.presetMessage);
    if(entry.id==='love-sign')setMessage('YOU');
  };
  const choosePaletteColor=(hex:string)=>{
    if(selected?.flowerSlots){const visibleFlower=Math.min(activeFlower,flowerCount-1);setFlowerColors(current=>current.map((value,index)=>index===visibleFlower?hex:value));return;}
    setColor(hex);
  };
  const canBuild=!!selected&&releasedSizes.length>0&&(!!selected.proceduralKey||!!selected.meshUrl)&&(!selected.supportsHolder||!!sanitiseMessage(message));
  const requestBuild=()=>{
    if(!selected||!canBuild)return;
    onClearGenerationError();
    void onGenerate(selected,buildColor,customOptions);
  };

  return <ScreenFrame accent="indigo" eyebrow="Library / Browse and customise" navigationDisabled={generating} onBack={onBack}
    subtitle={`${entries.length} production-ready products. Search, filter, choose a size and make it yours.`}
    title="Find your next build"
    footer={<PrimaryButton disabled={!canBuild||generating} label={generating?`Building certified size... ${Math.round(generationProgress*100)}%`:selected&&!releasedSizes.length?'Preview · certification pending':selected?`Build ${selected.name}`:'Choose an object to customise'} onPress={requestBuild}/>}>

    {catalogNotice?<View style={styles.pendingNotice}><Text style={styles.pendingNoticeCopy}>{catalogNotice}</Text></View>:null}
    <View style={styles.searchWrap}><Text style={styles.searchIcon}>⌕</Text><TextInput accessibilityLabel="Search objects" onChangeText={setQuery} placeholder="Search cars, roses, birthday, signs..." placeholderTextColor={colors.inkSoft} style={styles.search} value={query}/>{query?<Pressable accessibilityLabel="Clear search" accessibilityRole="button" onPress={()=>setQuery('')}><Text style={styles.clear}>×</Text></Pressable>:null}</View>

    <Text style={styles.kicker}>CATEGORY OR THEME</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollStrip}><View style={styles.chipRow}>{LIBRARY_CATEGORIES.map(item=><Pressable accessibilityRole="tab" accessibilityState={{selected:category===item.id}} key={item.id} onPress={()=>{setCategory(item.id);if(item.id==='message')select(MESSAGE_ENTRY);}} style={[styles.chip,category===item.id&&styles.chipActive]}><Text style={[styles.chipText,category===item.id&&styles.chipTextActive]}>{item.label}</Text></Pressable>)}</View></ScrollView>
    <View style={styles.catalogToolbar}><Text style={styles.resultCount}>{filtered.length} {filtered.length===1?'IDEA':'IDEAS'}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.sortRow}>{SORTS.map(item=><Pressable accessibilityLabel={`Sort by ${item.label}`} accessibilityRole="radio" accessibilityState={{checked:sort===item.id}} key={item.id} onPress={()=>setSort(item.id)} style={[styles.sortChip,sort===item.id&&styles.sortChipActive]}><Text style={styles.sortText}>{item.label}</Text></Pressable>)}</View></ScrollView></View>

    {category==='message'?<View style={styles.messageIntro}><Text style={styles.kicker}>CREATE FROM SCRATCH</Text><Text style={styles.messageIntroTitle}>Your words, built in bricks.</Text><Text style={styles.hint}>Up to 14 Latin letters, numbers and spaces. Longer messages wrap automatically. Pick the mounting style below.</Text></View>:
      visible.length?<View style={styles.grid}>{visible.map(entry=>{const active=entry.id===selectedId,released=isLibraryEntryReleased(entry);return <Pressable accessibilityRole="button" accessibilityState={{selected:active}} key={entry.id} onPress={()=>select(entry)} style={[styles.card,active&&styles.cardActive]}><View style={styles.thumbnail}><BrickThumbnail color={entry.defaultColor} entry={entry} options={{font:'block',holder:'flat',message:entry.presetMessage}}/>{!released?<View style={styles.previewBadge}><Text style={styles.previewBadgeText}>PREVIEW</Text></View>:null}</View><View style={styles.cardBody}><Text numberOfLines={2} style={styles.cardName}>{entry.name}</Text><Text style={styles.cardMeta}>{entry.theme?.replace('-', ' ')??entry.category}{released?'':' · certification pending'}</Text></View></Pressable>;})}</View>:
      <View style={styles.empty}><Text style={styles.emptyTitle}>No matching builds</Text><Text style={styles.hint}>Try another word or clear the category filter.</Text></View>}

    {category!=='message'&&pageCount>1?<View style={styles.pagination}><Pressable accessibilityLabel="Previous catalogue page" accessibilityRole="button" disabled={page===1} onPress={()=>setPage(value=>Math.max(1,value-1))} style={[styles.pageButton,page===1&&styles.disabled]}><Text style={styles.pageButtonText}>← Previous</Text></Pressable><Text style={styles.pageStatus}>{page} / {pageCount}</Text><Pressable accessibilityLabel="Next catalogue page" accessibilityRole="button" disabled={page===pageCount} onPress={()=>setPage(value=>Math.min(pageCount,value+1))} style={[styles.pageButton,page===pageCount&&styles.disabled]}><Text style={styles.pageButtonText}>Next →</Text></Pressable></View>:null}

    {generationError?<View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.generationError}><Text style={styles.generationErrorTitle}>BUILD STOPPED</Text><Text style={styles.generationErrorCopy}>{generationError}</Text><Pressable accessibilityLabel="Try building again" accessibilityRole="button" disabled={!canBuild||generating} onPress={requestBuild} style={[styles.retryButton,(!canBuild||generating)&&styles.disabled]}><Text style={styles.retryButtonText}>TRY AGAIN</Text></Pressable></View>:null}

    {selected?<View style={styles.customiser}>
      <View style={styles.customHeader}><View><Text style={styles.kicker}>CUSTOMISE YOUR BUILD</Text><Text style={styles.customTitle}>{selected.name}</Text></View><View style={styles.selectedPreview}><BrickThumbnail color={buildColor} entry={selected} options={customOptions}/></View></View>

      {(selected.supportsHolder||selected.id==='custom-message'||selected.id==='love-sign')?<><Text style={styles.kicker}>WORDS</Text><TextInput accessibilityLabel="Custom message" autoCapitalize="characters" maxLength={14} onChangeText={value=>setMessage(sanitiseMessage(value))} placeholder="YOUR MESSAGE" placeholderTextColor={colors.inkSoft} style={styles.messageInput} value={message}/><Text style={styles.hint}>A-Z, 0-9 and spaces only. Maximum 14 characters.</Text><Text style={styles.kicker}>FONT</Text><View style={styles.choiceRow}>{(['block','rounded','stencil'] as MessageFont[]).map(choice=><Pressable accessibilityLabel={`${FONT_LABELS[choice]} font`} accessibilityRole="radio" accessibilityState={{checked:font===choice}} key={choice} onPress={()=>setFont(choice)} style={[styles.choice,font===choice&&styles.choiceActive]}><Text style={styles.choiceTitle}>{choice==='stencil'?'A 9':'Aa 9'}</Text><Text style={styles.choiceCopy}>{FONT_LABELS[choice]}</Text></Pressable>)}</View><Text style={styles.kicker}>HOW TO DISPLAY IT</Text><View style={styles.choiceRow}>{(['freestanding','wall','flat'] as MessageHolder[]).map(choice=><Pressable accessibilityLabel={HOLDER_LABELS[choice]} accessibilityRole="radio" accessibilityState={{checked:holder===choice}} key={choice} onPress={()=>setHolder(choice)} style={[styles.choice,holder===choice&&styles.choiceActive]}><Text style={styles.choiceIcon}>{choice==='wall'?'▣':choice==='flat'?'▬':'⊥'}</Text><Text style={styles.choiceCopy}>{HOLDER_LABELS[choice]}</Text></Pressable>)}</View></>:null}

      {selected.flowerSlots?<><Text style={styles.kicker}>BOUQUET SIZE</Text><View style={styles.choiceRow}>{([1,3,5] as const).map(count=><Pressable accessibilityLabel={`${count===1?'Single':count===3?'Trio':'Lush'} bouquet`} accessibilityRole="radio" accessibilityState={{checked:flowerCount===count}} key={count} onPress={()=>setFlowerCount(count)} style={[styles.choice,flowerCount===count&&styles.choiceActive]}><Text style={styles.choiceTitle}>{count===1?'Single':count===3?'Trio':'Lush'}</Text><Text style={styles.choiceCopy}>{count} bloom{count>1?'s':''}</Text></Pressable>)}</View><Text style={styles.kicker}>CHOOSE EACH FLOWER</Text><View style={styles.flowerSlots}>{flowerColors.slice(0,flowerCount).map((hex,index)=><Pressable accessibilityLabel={`Flower ${index+1}`} accessibilityRole="radio" accessibilityState={{checked:activeFlower===index}} key={index} onPress={()=>setActiveFlower(index)} style={[styles.flowerSlot,{backgroundColor:hex},activeFlower===index&&styles.flowerSlotActive]}><Text style={styles.flowerNumber}>{index+1}</Text></Pressable>)}</View></>:null}

      <Text style={styles.kicker}>{selected.flowerSlots?'SELECTED FLOWER COLOUR':'MAIN COLOUR'}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollStrip}><View style={styles.colorRow}>{LIBRARY_COLORS.map(hex=><Pressable accessibilityLabel={`Colour ${hex}`} accessibilityRole="button" key={hex} onPress={()=>choosePaletteColor(hex)} style={[styles.colorDot,{backgroundColor:hex},(!selected.flowerSlots&&buildColor===hex)&&styles.colorDotActive]}/>)}</View></ScrollView>

      <Text style={styles.kicker}>CERTIFIED FINISHED SIZE</Text>{releasedSizes.length?<View style={styles.sizeColumn}>{releasedSizes.map(profile=>{const option=SCULPTURE_SIZE_OPTIONS[profile];return <Pressable accessibilityRole="radio" accessibilityState={{checked:size===profile}} key={profile} onPress={()=>setSize(profile)} style={[styles.sizeChoice,size===profile&&styles.sizeChoiceActive]}><View><Text style={styles.sizeTitle}>{option.name}</Text><Text style={styles.sizeCopy}>{option.promise}</Text></View><Text style={styles.sizeCm}>up to {Number(option.targetLongestCm.toFixed(1))} cm</Text></Pressable>;})}</View>:<View accessibilityLiveRegion="polite" style={styles.pendingNotice}><Text style={styles.pendingNoticeTitle}>PREVIEW AVAILABLE</Text><Text style={styles.pendingNoticeCopy}>This design is visible for inspiration and colour customisation. Ordering unlocks after its physical brick packing and child-friendly instructions pass certification.</Text></View>}
    </View>:null}
    <Text style={styles.disclaimer}>Original generic designs. Protected vehicle, game and character names are deliberately excluded.</Text>
  </ScreenFrame>;
}

const styles=StyleSheet.create({
  searchWrap:{alignItems:'center',backgroundColor:colors.white,borderColor:colors.ink,borderRadius:radius.md,borderWidth:2,flexDirection:'row',gap:8,marginBottom:spacing.lg,minHeight:52,paddingHorizontal:spacing.md},searchIcon:{color:colors.ink,fontSize:24,fontWeight:'900'},search:{...type.body,color:colors.ink,flex:1,fontSize:14},clear:{color:colors.ink,fontSize:24,fontWeight:'900'},kicker:{...type.label,color:colors.inkSoft,fontSize:9,marginBottom:spacing.sm},scrollStrip:{marginBottom:spacing.lg},chipRow:{flexDirection:'row',gap:spacing.sm,paddingRight:spacing.md},chip:{backgroundColor:colors.white,borderColor:colors.line,borderRadius:radius.pill,borderWidth:1.5,paddingHorizontal:14,paddingVertical:9},chipActive:{backgroundColor:colors.ink,borderColor:colors.ink},chipText:{...type.micro,color:colors.ink,fontSize:9,fontWeight:'900'},chipTextActive:{color:colors.white},catalogToolbar:{alignItems:'center',flexDirection:'row',gap:spacing.md,justifyContent:'space-between',marginBottom:spacing.md},resultCount:{...type.label,color:colors.ink,fontSize:10},sortRow:{flexDirection:'row',gap:6},sortChip:{backgroundColor:'#EEEAE1',borderRadius:radius.pill,paddingHorizontal:10,paddingVertical:7},sortChipActive:{backgroundColor:colors.blueSoft},sortText:{...type.micro,color:colors.ink,fontSize:8,fontWeight:'800'},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},card:{backgroundColor:colors.white,borderColor:colors.line,borderRadius:radius.md,borderWidth:1.5,overflow:'hidden',width:'48%'},cardActive:{borderColor:colors.blue,borderWidth:3},thumbnail:{aspectRatio:1.35,backgroundColor:'#F5F2EA',position:'relative',width:'100%'},thumbnailImage:{backgroundColor:colors.ink,height:'100%',width:'100%'},meshPlaceholder:{alignItems:'center',backgroundColor:colors.ink,height:'100%',justifyContent:'center',width:'100%'},meshPlaceholderText:{...type.label,color:colors.saffron,fontSize:11},previewBadge:{backgroundColor:colors.ink,borderRadius:radius.pill,left:6,paddingHorizontal:7,paddingVertical:4,position:'absolute',top:6},previewBadgeText:{...type.micro,color:colors.white,fontSize:7,fontWeight:'900'},cardBody:{padding:spacing.sm},cardName:{...type.body,color:colors.ink,fontSize:12,fontWeight:'900',lineHeight:14},cardMeta:{...type.micro,color:colors.inkSoft,fontSize:8,marginTop:3,textTransform:'uppercase'},pagination:{alignItems:'center',flexDirection:'row',justifyContent:'space-between',marginBottom:spacing.xl,marginTop:spacing.lg},pageButton:{backgroundColor:colors.ink,borderRadius:radius.pill,paddingHorizontal:14,paddingVertical:9},pageButtonText:{...type.micro,color:colors.white,fontSize:9,fontWeight:'900'},pageStatus:{...type.label,color:colors.ink,fontSize:10},disabled:{opacity:.28},empty:{alignItems:'center',backgroundColor:colors.white,borderRadius:radius.md,marginBottom:spacing.xl,padding:spacing.xl},emptyTitle:{...type.title,color:colors.ink,fontSize:18},
  generationError:{backgroundColor:'#FFF0EC',borderColor:colors.alarm,borderRadius:radius.md,borderWidth:2,gap:spacing.sm,marginTop:spacing.lg,padding:spacing.lg},generationErrorTitle:{...type.label,color:colors.alarm,fontSize:10},generationErrorCopy:{...type.body,color:colors.ink,fontSize:13,lineHeight:18},retryButton:{alignItems:'center',alignSelf:'flex-start',backgroundColor:colors.ink,borderRadius:radius.pill,minWidth:112,paddingHorizontal:16,paddingVertical:10},retryButtonText:{...type.label,color:colors.white,fontSize:9},pendingNotice:{backgroundColor:'#FFF7D6',borderColor:'#B18400',borderRadius:radius.sm,borderWidth:1.5,gap:6,marginBottom:spacing.lg,padding:spacing.md},pendingNoticeTitle:{...type.label,color:'#765800',fontSize:9},pendingNoticeCopy:{...type.micro,color:colors.ink,fontSize:9,lineHeight:14},
  messageIntro:{backgroundColor:colors.ink,borderRadius:radius.md,marginBottom:spacing.xl,padding:spacing.xl},messageIntroTitle:{...type.title,color:colors.white,fontSize:24,marginBottom:8},hint:{...type.micro,color:colors.inkSoft,fontSize:9,lineHeight:13,marginBottom:spacing.lg,marginTop:5},customiser:{backgroundColor:colors.white,borderColor:colors.ink,borderRadius:radius.md,borderWidth:2,marginBottom:spacing.xl,marginTop:spacing.xl,padding:spacing.lg},customHeader:{alignItems:'center',flexDirection:'row',justifyContent:'space-between',marginBottom:spacing.lg},customTitle:{...type.title,color:colors.ink,fontSize:21},selectedPreview:{borderColor:colors.line,borderRadius:radius.sm,borderWidth:1,height:72,overflow:'hidden',width:96},messageInput:{...type.title,backgroundColor:'#F5F2EA',borderColor:colors.ink,borderRadius:radius.sm,borderWidth:2,color:colors.ink,fontSize:20,minHeight:52,paddingHorizontal:spacing.md},choiceRow:{flexDirection:'row',gap:spacing.sm,marginBottom:spacing.lg},choice:{alignItems:'center',borderColor:colors.line,borderRadius:radius.sm,borderWidth:1.5,flex:1,justifyContent:'center',minHeight:62,padding:spacing.sm},choiceActive:{backgroundColor:colors.blueSoft,borderColor:colors.ink,borderWidth:2},choiceTitle:{color:colors.ink,fontSize:15,fontWeight:'900'},choiceIcon:{color:colors.ink,fontSize:21,fontWeight:'900'},choiceCopy:{...type.micro,color:colors.inkSoft,fontSize:8,fontWeight:'900',textAlign:'center'},flowerSlots:{flexDirection:'row',gap:spacing.sm,marginBottom:spacing.lg},flowerSlot:{alignItems:'center',borderColor:colors.line,borderRadius:radius.pill,borderWidth:2,height:42,justifyContent:'center',width:42},flowerSlotActive:{borderColor:colors.ink,borderWidth:4},flowerNumber:{color:colors.ink,fontSize:10,fontWeight:'900'},colorRow:{flexDirection:'row',gap:spacing.sm,paddingVertical:2},colorDot:{borderColor:colors.line,borderRadius:radius.pill,borderWidth:2,height:38,width:38},colorDotActive:{borderColor:colors.ink,borderWidth:4},sizeColumn:{gap:spacing.sm,marginBottom:spacing.lg},sizeChoice:{alignItems:'center',borderColor:colors.line,borderRadius:radius.sm,borderWidth:1.5,flexDirection:'row',justifyContent:'space-between',padding:spacing.md},sizeChoiceActive:{backgroundColor:colors.blueSoft,borderColor:colors.ink,borderWidth:2},sizeTitle:{...type.body,color:colors.ink,fontWeight:'900'},sizeCopy:{...type.micro,color:colors.inkSoft,fontSize:8},sizeCm:{...type.label,color:colors.blue,fontSize:9},disclaimer:{...type.micro,color:colors.inkSoft,fontSize:9,lineHeight:13,marginTop:spacing.sm},
});
