import { LIBRARY_SEED, type LibraryEntry, type MessageFont } from '../data/carLibrary';
import { assessBuildAsync } from './kitAssessment';
import { buildModelFromCells, voxelize, type BuildProfile, type VoxelCell, type VoxelModel, type VoxelZone } from './voxelFox';
import type { PhotoModels } from './photoEngine/voxelizePhoto';

type Classifier = (x: number, y: number, z: number) => VoxelZone | null;
type Bounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
export type MessageHolder = 'freestanding' | 'wall' | 'flat';
export interface LibraryBuildOptions {
  message?: string;
  font?: MessageFont;
  size?: BuildProfile;
  holder?: MessageHolder;
  flowerColors?: string[];
  flowerCount?: 1 | 3 | 5;
  /** Composed bouquet entries: id of the chosen vase option ('none' = hand-tied). */
  vase?: string;
}

const RELEASE_PENDING_IDS=new Set([
  'bigcat-cheetah','bigcat-jaguar','bigcat-lion','bigcat-snow-leopard','bigcat-tiger',
  'candy-cane','cat-black','cat-siamese','cat-sphynx','cat-tabby','champagne-toast',
  'dad-toolbox','dad-trophy','daffodil-bloom','dahlia-bloom','daisy-bloom','dino-raptor',
  'dog-beagle','dog-bulldog','dog-poodle','dog-retriever','engagement-bouquet','farm-cow',
  'farm-goat','farm-horse','farm-pig','farm-pony','farm-sheep','grad-cap','hibiscus-bloom',
  'jet-carrier','jet-classic-swept','jet-delta','jet-display','jet-future','jet-stealth',
  'jet-trainer','jet-twin-tail','joined-rings','lily-bloom','lotus-bloom','mother-bouquet',
  'north-star','orchid-bloom','peony-bloom','plant-succulent','poppy-bloom',
  'proposal-ring-box','rose-bloom','safari-zebra','sunflower-bloom','tree-palm',
  'wedding-arch','wedding-bouquet','wild-bouquet',
]);
const BALANCED_ONLY_IDS=new Set([
  'cat-longhair','dino-brachiosaurus','dog-husky','ginger-friend','maze-chaser','safari-giraffe',
]);
const BALANCED_PENDING_IDS=new Set([
  'cherry-blossom','dog-dachshund','farm-rabbit','iris-bloom','lavender-bunch','love-sign',
  'mixed-bouquet','rocket-moon','rocket-satellite','rose-bouquet-large','tulip-bloom',
  'tulip-bouquet','word-best-dad','word-class-year','word-congrats-grad','word-couple-names',
  'word-just-married','word-love-mom','word-thankful','word-we-said-yes',
]);
const CURATED_PROCEDURAL_IDS=new Set(LIBRARY_SEED.filter(entry=>entry.proceduralKey).map(entry=>entry.id));

/**
 * Profiles certified offline against the current catalog and assembly-plan
 * rules. Detailed stays hidden until it passes the same release suite; a
 * high-resolution preview alone is not a sellable kit.
 */
export function releasedProceduralLibraryProfiles(entry:LibraryEntry):BuildProfile[]{
  if(!entry.proceduralKey)return entry.meshUrl?['efficient','balanced','detailed']:[];
  if(entry.id!=='custom-message'&&!CURATED_PROCEDURAL_IDS.has(entry.id))return [];
  if(RELEASE_PENDING_IDS.has(entry.id))return [];
  if(BALANCED_ONLY_IDS.has(entry.id))return ['balanced'];
  return BALANCED_PENDING_IDS.has(entry.id)?['efficient']:['efficient','balanced'];
}

export function isLibraryEntryReleased(entry:LibraryEntry):boolean{
  return releasedProceduralLibraryProfiles(entry).length>0;
}

const ellipsoid = (x:number,y:number,z:number,cx:number,cy:number,cz:number,rx:number,ry:number,rz:number) =>
  ((x-cx)/rx)**2 + ((y-cy)/ry)**2 + ((z-cz)/rz)**2 <= 1;
const box = (x:number,y:number,z:number,cx:number,cy:number,cz:number,rx:number,ry:number,rz:number) =>
  Math.abs(x-cx)<=rx && Math.abs(y-cy)<=ry && Math.abs(z-cz)<=rz;

function car(kind: string): { classify: Classifier; bounds: Bounds } {
  const hash=[...kind].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  const open = /open|roadster|buggy|speedster/.test(kind);
  const boxy = /rally|muscle|micro/.test(kind);
  const wing = /track|arrow/.test(kind);
  const length = 2.78+(hash%6)*.1+(kind.includes('streamliner') ? .28 : 0);
  const wheelBase=1.48+(hash%4)*.09;
  const cabinCenter=-.42+(hash%5)*.11;
  const cabinSpan=.88+(hash%3)*.12;
  const cabinHeight=boxy?1.7:1.42+(hash%4)*.06;
  const classify: Classifier = (x,y,z) => {
    for (const wx of [-wheelBase,wheelBase]) {
      const r=(x-wx)**2+(y-.52)**2;
      if (Math.abs(z)>.72 && r<.48**2) return r<.22**2 ? 'cream' : 'dark';
      if (Math.abs(z)>.66 && r<.58**2) return null;
    }
    if (Math.abs(x)>length || Math.abs(z)>1.05 || y<.25) return null;
    const hood = boxy ? 1.15 : .82 + Math.max(0,1-Math.abs(x)/length)*.28;
    const cabin = Math.abs(x-cabinCenter)<cabinSpan && (!open || x<-.2);
    const top = cabin ? (boxy ? cabinHeight : cabinHeight-Math.abs(x-cabinCenter)*.24) : hood;
    if (y>top || (y>1.05 && Math.abs(z)>.78)) return null;
    if (cabin && y>1.14 && (Math.abs(z)>.54 || Math.abs(x+.25)>.72)) return 'mint';
    if (x>length-.18 && y>.5 && Math.abs(z)>.48) return 'cream';
    if (x<-length+.18 && y>.48 && Math.abs(z)>.5) return 'accent';
    if (wing && x<-2.15 && y>1.15 && y<1.34 && Math.abs(z)<1.25) return 'dark';
    if (y<.42) return 'dark';
    return 'body';
  };
  return { bounds:{minX:-3.35,maxX:3.35,minY:0,maxY:1.9,minZ:-1.3,maxZ:1.3}, classify };
}

function flower(kind:string,count:1|3|5=5): { classify:Classifier; bounds:Bounds } {
  const classify:Classifier=(x,y,z)=>{
    if (Math.abs(x)<.13 && Math.abs(z)<.13 && y<3.05) return 'accent';
    if (ellipsoid(x,y,z,-.45,1.5,0,.65,.18,.35)||ellipsoid(x,y,z,.42,2.05,0,.62,.18,.35)) return 'accent';
    if (kind==='sunflower-bloom'||kind==='daisy-bloom'||kind==='poppy-bloom') {
      const petals=kind==='sunflower-bloom'?12:kind==='daisy-bloom'?9:6;
      const ring=kind==='poppy-bloom' ? .65 : .82;
      for(let p=0;p<petals;p++){const a=p*Math.PI*2/petals;if(ellipsoid(x,y,z,Math.cos(a)*ring,3.2,Math.sin(a)*ring,kind==='daisy-bloom' ? .42 : .5,.18,kind==='poppy-bloom' ? .38 : .28))return kind==='poppy-bloom'?'body':'cream';}
      if(ellipsoid(x,y,z,0,3.2,0,kind==='sunflower-bloom' ? .58 : .38,.34,kind==='sunflower-bloom' ? .58 : .38))return 'dark';
    } else if(kind==='tulip-bloom') {
      for(const s of [-1,0,1]) if(ellipsoid(x,y,z,s*.38,3.18,0,.48,.72,.46)) return s===0?'body':'cream';
    } else if(kind==='orchid-bloom'||kind==='lily-bloom'||kind==='hibiscus-bloom') {
      const petals=kind==='lily-bloom'?6:5,ring=kind==='hibiscus-bloom' ? .76 : .62;
      for(let p=0;p<petals;p++){const a=p*Math.PI*2/petals;if(ellipsoid(x,y,z,Math.cos(a)*ring,3.2,Math.sin(a)*ring,kind==='orchid-bloom' ? .62 : .52,.22,kind==='lily-bloom' ? .5 : .42))return p===0&&kind==='orchid-bloom'?'accent':'body';}
      if(ellipsoid(x,y,z,0,3.15,kind==='hibiscus-bloom' ? .48 : .2,.27,.3,kind==='hibiscus-bloom' ? .52 : .27))return 'cream';
    } else if(kind==='lotus-bloom'||kind==='dahlia-bloom'||kind==='peony-bloom') {
      const petals=kind==='dahlia-bloom'?12:kind==='peony-bloom'?8:10,ring=kind==='peony-bloom' ? .48 : .65;
      for(let p=0;p<petals;p++){const a=p*Math.PI*2/petals;if(ellipsoid(x,y,z,Math.cos(a)*ring,3.05+(kind==='dahlia-bloom'?(p%2)*.12:0),Math.sin(a)*ring,kind==='dahlia-bloom' ? .4 : .58,.18,kind==='peony-bloom' ? .42 : .3))return p%2?'cream':'body';}
      if(y<.2&&ellipsoid(x,y,z,0,.1,0,1.25,.12,1.25))return 'accent';
    } else if(kind==='daffodil-bloom') {
      for(let p=0;p<6;p++){const a=p*Math.PI/3;if(ellipsoid(x,y,z,Math.cos(a)*.55,3.15,Math.sin(a)*.55,.5,.18,.3))return'body';}
      if(ellipsoid(x,y,z,0,3.2,.35,.32,.32,.45))return'cream';
    } else if(kind==='iris-bloom') {
      for(const side of [-1,0,1])if(ellipsoid(x,y,z,side*.38,3.2,side===0 ? .25 : 0,.42,.78,.3))return side===0?'cream':'body';
    } else if(kind==='lavender-bunch') {
      for(const sx of [-.45,-.15,.15,.45])for(let p=0;p<5;p++)if(ellipsoid(x,y,z,sx,2.55+p*.22,0,.18,.16,.18))return p%2?'cream':'body';
    } else if(kind==='cherry-blossom') {
      if(Math.abs(y-(2.1+x*.6))<.12&&Math.abs(z)<.12&&x>-1.1&&x<1.1)return'dark';
      for(const [cx,cy] of [[-.85,2.0],[-.35,2.35],[.2,2.55],[.75,2.9]] as [number,number][])if(ellipsoid(x,y,z,cx,cy,.05,.38,.35,.3))return'body';
    } else if(kind==='wild-bouquet'||kind.includes('bouquet')) {
      const spread=kind.includes('tulip') ? .72 : kind.includes('wedding') ? .64 : kind.includes('engagement') ? .52 : kind.includes('rose') ? .48 : .58;
      const lift=kind.includes('engagement') ? .22 : kind.includes('mother') ? .18 : kind.includes('mixed')||kind.includes('wedding') ? .08 : 0;
      const blooms=([[-spread,3.05+lift,0],[0,3.38+lift,.1],[spread,3.05+lift,0],[-spread*.45,2.8+lift,.45],[spread*.5,2.8+lift,.42]] as [number,number,number][]).slice(0,count);
      for(const [cx,cy,cz] of blooms)
        if(ellipsoid(x,y,z,cx,cy,cz,kind.includes('rose') ? .34 : kind.includes('tulip') ? .32 : .42,kind.includes('tulip') ? .62 : .42,.3))return cx<0?'body':cx>0?'cream':'accent';
    } else {
      for(let p=0;p<8;p++){const a=p*Math.PI/4;const r=.18+p*.055;if(ellipsoid(x,y,z,Math.cos(a)*r,3.15+p*.025,Math.sin(a)*r,.5-p*.025,.24,.34-p*.018))return p%3===0?'dark':'body';}
    }
    return null;
  };
  return {bounds:{minX:-1.5,maxX:1.5,minY:0,maxY:4,minZ:-1.4,maxZ:1.4},classify};
}

function plant(kind:string):{classify:Classifier;bounds:Bounds}{
  const classify:Classifier=(x,y,z)=>{
    const potted=kind.startsWith('plant-');
    if(potted&&box(x,y,z,0,.35,0,.72,.35,.62))return'dark';
    if(kind==='plant-cactus'){
      if(box(x,y,z,0,1.65,0,.32,1.35,.32)||box(x,y,z,-.62,1.65,0,.45,.25,.25)||box(x,y,z,-.92,2.05,0,.22,.65,.22)||box(x,y,z,.62,1.3,0,.42,.22,.22)||box(x,y,z,.93,1.65,0,.22,.58,.22))return'body';
    } else if(kind==='plant-succulent'){
      for(let p=0;p<10;p++){const a=p*Math.PI/5;if(ellipsoid(x,y,z,Math.cos(a)*.45,.92,Math.sin(a)*.45,.48,.2,.22))return p%2?'body':'cream';}
    } else if(kind==='plant-monstera'){
      for(const [cx,cy,cz] of [[-.6,1.55,0],[.55,1.9,.1],[0,2.45,-.1]] as [number,number,number][]){if(Math.abs(x-cx)<.08&&y<cy&&y>.6&&Math.abs(z)<.08)return'accent';if(ellipsoid(x,y,z,cx,cy,cz,.7,.48,.28)&&!(Math.abs(x-cx)<.1&&Math.abs(z-cz)<.3))return'body';}
    } else if(kind==='plant-snake'){
      for(const sx of [-.48,-.24,0,.24,.48])if(Math.abs(x-sx)<.14&&Math.abs(z)<.22&&y>.65&&y<2.2+Math.abs(sx)*1.1)return Math.round((sx+1)*10)%2?'body':'cream';
    } else {
      const trunkHeight=kind==='tree-palm'?2.8:kind==='plant-bonsai'?1.45:2.15;
      if(Math.abs(x)<(.16+.04*y)&&Math.abs(z)<.2&&y<(potted ? .65 : 0)+trunkHeight)return'dark';
      if(kind==='tree-pine'){
        if(y>.75&&y<4.2&&Math.abs(x)<(4.35-y)*.42&&Math.abs(z)<(4.35-y)*.32)return'body';
      }else if(kind==='tree-palm'){
        for(let p=0;p<8;p++){const a=p*Math.PI/4;const cx=Math.cos(a)*1.05,cz=Math.sin(a)*1.05;if(ellipsoid(x,y,z,cx,3.25,cz,1.05,.22,.34))return'body';}
      }else{
        const cy=kind==='plant-bonsai'?2.0:3.0,rx=kind==='plant-bonsai'?1.25:1.65;
        const canopyY=kind==='tree-autumn'?2.75:cy,canopyX=kind==='tree-autumn'?1.82:rx;
        if(ellipsoid(x,y,z,0,canopyY,0,canopyX,kind==='plant-bonsai' ? .7 : kind==='tree-autumn'?1.05:1.2,1.1))return kind==='tree-cherry'?'cream':kind==='tree-autumn'&&x>0?'accent':'body';
      }
    }
    return null;
  };
  return {bounds:{minX:-2,maxX:2,minY:0,maxY:4.5,minZ:-1.6,maxZ:1.6},classify};
}

function animal(kind:string):{classify:Classifier;bounds:Bounds}{
  const hash=[...kind].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  const classify:Classifier=(x,y,z)=>{
    if(kind==='safari-elephant'){
      for(const lx of [-.92,.82])for(const lz of [-.56,.56])if(box(x,y,z,lx,.58,lz,.3,.58,.3))return'dark';
      if(ellipsoid(x,y,z,0,1.55,0,1.65,1.02,.94))return'body';
      if(ellipsoid(x,y,z,1.52,1.72,0,.82,.82,.78))return'body';
      if(box(x,y,z,2.02,.82,0,.22,.9,.24)||ellipsoid(x,y,z,1.98,.18,0,.34,.26,.3))return'body';
      if(ellipsoid(x,y,z,1.35,1.88,-.72,.62,.72,.18)||ellipsoid(x,y,z,1.35,1.88,.72,.62,.72,.18))return'cream';
      if(ellipsoid(x,y,z,2.12,.88,-.32,.11,.62,.11)||ellipsoid(x,y,z,2.12,.88,.32,.11,.62,.11))return'cream';
      return null;
    }
    if(kind==='safari-giraffe'){
      for(const lx of [-.75,.68])for(const lz of [-.42,.42])if(box(x,y,z,lx,.88,lz,.18,.88,.18))return'dark';
      if(ellipsoid(x,y,z,0,1.95,0,1.35,.67,.67))return Math.floor((x+z)*3)%3===0?'dark':'body';
      if(box(x,y,z,1.02,3.05,0,.28,1.38,.3))return Math.floor(y*3)%4===0?'dark':'body';
      if(ellipsoid(x,y,z,1.38,4.42,0,.7,.44,.4))return'body';
      if(box(x,y,z,1.18,4.92,-.18,.08,.3,.08)||box(x,y,z,1.18,4.92,.18,.08,.3,.08))return'dark';
      return null;
    }
    if(kind==='safari-rhino'){
      for(const lx of [-.9,.78])for(const lz of [-.48,.48])if(box(x,y,z,lx,.48,lz,.3,.48,.3))return'dark';
      if(ellipsoid(x,y,z,-.15,1.24,0,1.62,.9,.88)||ellipsoid(x,y,z,1.38,1.32,0,.9,.65,.72))return'body';
      if(ellipsoid(x,y,z,2.18,1.68,0,.64,.14,.14)||ellipsoid(x,y,z,1.86,1.93,0,.38,.11,.11))return'cream';
      return null;
    }
    if(kind==='safari-hippo'){
      for(const lx of [-.85,.72])for(const lz of [-.52,.52])if(box(x,y,z,lx,.38,lz,.32,.38,.32))return'dark';
      if(ellipsoid(x,y,z,-.18,1.2,0,1.68,1.03,1.04))return'body';
      if(ellipsoid(x,y,z,1.45,1.3,0,1.02,.72,.88))return z>.62&&Math.abs(x-1.65)>.24?'cream':'body';
      return null;
    }
    if(kind==='farm-rabbit'){
      if(ellipsoid(x,y,z,-.28,.92,0,1.02,.88,.72)||ellipsoid(x,y,z,.72,1.48,0,.62,.62,.56))return'body';
      if(ellipsoid(x,y,z,.55,2.42,-.25,.2,.9,.19)||ellipsoid(x,y,z,.55,2.42,.25,.2,.9,.19))return'cream';
      if(ellipsoid(x,y,z,-1.12,1.12,0,.38,.38,.38))return'cream';
      return null;
    }
    if(kind.startsWith('dino-')){
      if(kind==='dino-brachiosaurus'){
        for(const lx of [-.9,.72])for(const lz of [-.42,.42])if(box(x,y,z,lx,.62,lz,.24,.62,.24))return'dark';
        if(ellipsoid(x,y,z,-.35,1.42,0,1.6,.78,.72))return'body';
        if(box(x,y,z,1.02,2.65,0,.3,1.55,.3)||ellipsoid(x,y,z,1.18,4.22,0,.64,.4,.38))return'body';
        if(x<-1.4&&x>-3.15&&Math.abs(y-(1.4+(x+1.4)*.18))<.2&&Math.abs(z)<.22)return'accent';
        return null;
      }
      const raptor=kind==='dino-raptor',stego=kind==='dino-stegosaurus',tri=kind==='dino-triceratops';
      const bodyY=raptor?1.7:tri?1.18:1.5;
      if(ellipsoid(x,y,z,-.25,bodyY,0,raptor?1.25:1.55,raptor?.58:.78,raptor?.48:.72))return'body';
      for(const lx of [-.62,.52])if(box(x,y,z,lx,.58,raptor?-.22:.28,.23,.68,.25))return'dark';
      if(x<-1.25&&x>-3.1&&Math.abs(y-(bodyY+(x+1.25)*.22))<(.24+(x+3.1)*.04)&&Math.abs(z)<.24)return'accent';
      if(tri){
        if(ellipsoid(x,y,z,1.28,1.35,0,.9,.64,.72))return'body';
        if(box(x,y,z,.72,1.65,0,.18,.82,.9))return'dark';
        for(const hz of [-.42,.42])if(ellipsoid(x,y,z,2.0,1.62,hz,.72,.11,.11))return'cream';
        if(ellipsoid(x,y,z,1.78,1.98,0,.52,.1,.1))return'cream';
      }else if(stego){
        for(let p=0;p<6;p++)if(Math.abs(x-(-1.05+p*.42))<.24&&y>2.0&&y<2.58-(Math.abs(p-2.5)*.08)&&Math.abs(z)<.18)return p%2?'cream':'dark';
      }else{
        const hx=raptor?1.18:1.28,hy=raptor?2.08:2.48;
        if(ellipsoid(x,y,z,hx,hy,0,raptor?.72:1.0,raptor?.48:.65,raptor?.45:.58))return'body';
        if(box(x,y,z,.72,raptor?1.65:1.95,-.55,.65,.11,.12))return'accent';
      }
      return null;
    }

    const isDog=kind.startsWith('dog-'),isCat=kind.startsWith('cat-'),isBigCat=kind.startsWith('bigcat-');
    const isPig=kind==='farm-pig',isHorse=kind==='farm-horse'||kind==='farm-pony',isCow=kind==='farm-cow',isSheep=kind==='farm-sheep',isGoat=kind==='farm-goat',isZebra=kind==='safari-zebra';
    const short=kind==='dog-dachshund'||isPig;
    const stocky=kind==='dog-bulldog'||kind==='bigcat-jaguar'||isCow||isSheep;
    const slim=kind==='cat-sphynx'||kind==='bigcat-cheetah'||isHorse||isZebra||isGoat;
    const bodyLength=kind==='dog-dachshund'?1.72:kind==='dog-bulldog'?1.04:isBigCat?1.62:isHorse||isZebra?1.58:isPig?1.25:1.22+(hash%5)*.055;
    const bodyY=short?.88:isHorse||isZebra?1.55:isBigCat?1.32:1.18;
    const bodyHeight=stocky?.78:slim?.58:.66;
    const bodyWidth=isSheep?.83:isBigCat?.68:isPig?.8:.57+(hash%3)*.035;
    for(const lx of [-bodyLength*.55,bodyLength*.55])for(const lz of [-bodyWidth*.58,bodyWidth*.58]){
      const legHeight=short?.42:isHorse||isZebra?1.05:isBigCat?.78:.66;
      if(box(x,y,z,lx,legHeight/2,lz,slim?.14:.18,legHeight/2,.16))return'dark';
    }
    if(ellipsoid(x,y,z,0,bodyY,0,bodyLength,bodyHeight,bodyWidth)){
      if(isSheep&&(Math.floor((x+2)*4)+Math.floor((z+1)*4))%3===0)return'cream';
      if(kind==='bigcat-tiger'||isZebra||kind==='cat-tabby')return Math.floor((x+2.5)*4)%3===0?'dark':'body';
      if(kind==='bigcat-jaguar'||kind==='bigcat-cheetah'||kind==='bigcat-snow-leopard')return Math.floor((x+z+3)*5)%5===0?'dark':'body';
      if(isCow)return x*z>0?'dark':'cream';
      return'body';
    }
    const headX=bodyLength*.86,headY=bodyY+bodyHeight*.72+((isHorse||isZebra||isGoat)?.35:0);
    if(box(x,y,z,bodyLength*.65,(bodyY+headY)/2,0,.28,Math.max(.25,(headY-bodyY)/2+.18),.32))return'body';
    if(ellipsoid(x,y,z,headX,headY,0,stocky?.62:slim?.46:.54,stocky?.58:.5,stocky?.54:.46)){
      if(kind==='cat-siamese'&&Math.abs(x-headX)>.18)return'dark';
      return'body';
    }
    if(ellipsoid(x,y,z,headX+.42,headY-.1,0,isPig?.42:(isHorse||isZebra)?.5:.32,.23,.3))return isPig?'cream':'body';
    if(kind==='bigcat-lion'&&ellipsoid(x,y,z,headX-.12,headY,0,.88,.86,.72)&&!ellipsoid(x,y,z,headX,headY,0,.58,.58,.6))return'dark';
    if(kind==='dog-poodle')for(const [cx,cy,cz] of [[-bodyLength,bodyY+.2,0],[headX,headY+.45,0],[.72,.45,.48],[-.72,.45,-.48]] as [number,number,number][])if(ellipsoid(x,y,z,cx,cy,cz,.4,.4,.36))return'cream';
    const pointy=isCat||isBigCat||kind==='dog-husky'||isGoat;
    if(pointy){for(const ez of [-.3,.3])if(Math.abs(x-(headX-.06))<.22&&y>headY+.28&&y<headY+.88&&Math.abs(z-ez)<(.34-(y-headY)*.25))return'dark';}
    else for(const ez of [-.42,.42])if(ellipsoid(x,y,z,headX-.08,headY-.1,ez,.28,.5,.18))return'dark';
    if(isCow||isGoat){for(const hz of [-.38,.38])if(ellipsoid(x,y,z,headX-.08,headY+.62,hz,.16,.58,.13))return'cream';}
    if(isHorse||isZebra)if(box(x,y,z,headX-.5,headY+.2,-.52,.14,.72,.12))return'dark';
    if(isPig&&ellipsoid(x,y,z,-bodyLength-.15,bodyY+.25,0,.28,.28,.2))return'dark';
    const fluffy=kind==='cat-longhair'||kind==='bigcat-snow-leopard'||kind==='dog-husky';
    if(x<-bodyLength*.78&&x>-bodyLength-1.35&&Math.abs(y-(bodyY+.3-(x+bodyLength)*.35))<(fluffy?.25:.14)&&Math.abs(z)<(fluffy?.26:.14))return fluffy?'cream':'body';
    return null;
  };
  return {bounds:{minX:-3.35,maxX:3.15,minY:0,maxY:5.25,minZ:-1.6,maxZ:1.6},classify};
}

function aircraft(kind:string):{classify:Classifier;bounds:Bounds}{
  const hash=[...kind].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  const delta=kind==='jet-delta'||kind==='jet-stealth'||kind==='jet-future';
  const classify:Classifier=(x,y,z)=>{
    if(ellipsoid(x,y,z,.15,1.15,0,2.7,.38,.38))return x>1.35?'cream':x<-1.75?'dark':'body';
    const wingSpan=(delta?2.15:1.58)+(hash%5)*.08;
    if(x<.9&&x>-1.45&&Math.abs(z)<wingSpan*Math.max(.15,(1.3-x)/2.75)&&Math.abs(y-1.08)<.13)return'body';
    if(x<-1.55&&Math.abs(z)<.75&&Math.abs(y-1.2)<.13)return'body';
    if(x<-1.45&&y>1.1&&y<1.9&&Math.abs(z)<.15)return'dark';
    if(kind==='jet-twin-tail'&&x<-1.45&&y>1.1&&y<1.85&&Math.abs(Math.abs(z)-.38)<.13)return'dark';
    if(x>.45&&x<1.25&&y>1.28&&ellipsoid(x,y,z,.8,1.4,0,.55,.25,.22))return'mint';
    if(kind==='jet-stealth'&&x>-.8&&x<1.75&&Math.abs(z)<1.45*(1.8-x)/2.6&&Math.abs(y-.92)<.16)return'dark';
    if(kind==='jet-future'&&x>.85&&x<1.55&&Math.abs(z)>.45&&Math.abs(z)<1.05&&Math.abs(y-1.05)<.12)return'accent';
    return null;
  };
  return {bounds:{minX:-3,maxX:3,minY:.4,maxY:2.1,minZ:-2.5,maxZ:2.5},classify};
}

function spacecraft(kind:string):{classify:Classifier;bounds:Bounds}{
  const hash=[...kind].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  const classify:Classifier=(x,y,z)=>{
    if(kind==='rocket-mars'){
      if(box(x,y,z,0,.8,0,1.2,.45,.85))return'body';
      for(const sx of [-.85,.85])for(const sz of [-.65,.65])if(ellipsoid(x,y,z,sx,.38,sz,.38,.38,.22))return'dark';
      if(box(x,y,z,0,1.55,0,.08,.55,.08))return'cream';
      return null;
    }
    if(kind==='rocket-lunar'){
      if(box(x,y,z,0,1.25,0,.65,.65,.65))return'body';
      for(const sx of [-1,1])for(const sz of [-1,1])if(Math.abs(x-sx*.62)<.1&&Math.abs(z-sz*.62)<.1&&y<1.05)return'dark';
      if(ellipsoid(x,y,z,0,2.05,0,.45,.55,.45))return'cream';
      return null;
    }
    if(kind==='rocket-shuttle'){
      if(ellipsoid(x,y,z,0,2.25,0,.48,2.15,.48))return y>3.35?'dark':'cream';
      if(y<2.5&&y>.9&&Math.abs(x)<1.65*(2.7-y)&&Math.abs(z)<.16)return'body';
      return null;
    }
    const cores=kind==='rocket-heavy'?[-.55,0,.55]:[0], radius=.25+(hash%4)*.025, height=3.3+(hash%4)*.1;
    for(const cx of cores){if(box(x,y,z,cx,height/2+.12,0,radius,height/2,radius))return Math.round(y*2)%3===0?'dark':'cream';if(y>height&&ellipsoid(x,y,z,cx,height+.15,0,radius+.02,.52,radius+.02))return'body';if(y<.3&&Math.abs(x-cx)<radius+.16&&Math.abs(z)<radius+.14)return'accent';}
    if(kind==='rocket-modern'&&box(x,y,z,0,3.2,0,.45,.18,.45))return'dark';
    if(kind==='rocket-moon'&&y<2.4&&y>.25&&Math.abs(Math.abs(x)-.58)<.22&&Math.abs(z)<.22)return'body';
    if(kind==='rocket-early'&&y<.95&&Math.abs(x)>.2&&Math.abs(x)<.75&&Math.abs(z)<.18)return'accent';
    if(kind==='rocket-satellite'&&y>3.55&&box(x,y,z,0,3.92,0,.52,.18,.52))return'mint';
    if(kind==='rocket-future'&&ellipsoid(x,y,z,0,2,0,.75,1.95,.55))return y>3.2?'mint':'body';
    return null;
  };
  return {bounds:{minX:-2,maxX:2,minY:0,maxY:4.6,minZ:-1.5,maxZ:1.5},classify};
}

function heartShape(x:number,y:number,z:number,scale=1){
  const X=x/scale, Y=(y-1.45)/scale;
  return (X*X+Y*Y-1)**3-X*X*Y*Y*Y<=0 && Math.abs(z)<.32*scale;
}

function icon(key:string): { classify:Classifier; bounds:Bounds } {
  const classify:Classifier=(x,y,z)=>{
    if(key==='winter-tree'){
      if(box(x,y,z,0,.55,0,.23,.55,.23))return 'dark';
      if(y>.45&&y<3.75&&Math.abs(x)<(3.9-y)*.48&&Math.abs(z)<(3.9-y)*.34)return (Math.round(y*3)+Math.round(x*4))%9===0?'accent':'body';
      if(y>3.55&&ellipsoid(x,y,z,0,3.75,0,.36,.36,.2))return 'cream';
    }
    if(key==='snow-friend'){
      if(ellipsoid(x,y,z,0,.85,0,1,1,1)||ellipsoid(x,y,z,0,2.25,0,.72,.72,.72)){
        if(y>2.2&&z>.55&&Math.abs(x)>.22)return 'dark';
        if(y>2.05&&z>.65&&Math.abs(x)<.18)return 'accent';
        return 'cream';
      }
    }
    if(key==='gift-box') return box(x,y,z,0,1,0,1.15,1,1.05) ? (Math.abs(x)<.18||Math.abs(z)<.18?'cream':'body') : null;
    if(key==='candy-cane'){const curved=ellipsoid(x,y,z,.35,2.65,0,.72,.72,.28)&&!ellipsoid(x,y,z,.35,2.65,0,.38,.38,.4);if(curved||box(x,y,z,-.35,1.4,0,.28,1.4,.28))return Math.round(y*4)%2?'body':'cream';}
    if(key==='winter-stocking'&&(box(x,y,z,-.25,1.7,0,.58,1.25,.3)||box(x,y,z,.3,.45,0,.9,.45,.3)))return y>2.55?'cream':'body';
    if(key==='tree-bauble'){if(ellipsoid(x,y,z,0,1.5,0,1.2,1.3,.65))return Math.abs(x)<.16?'cream':'body';if(box(x,y,z,0,2.9,0,.28,.25,.28))return'dark';}
    if(key==='ginger-friend'){if(ellipsoid(x,y,z,0,2.45,0,.65,.65,.3)||box(x,y,z,0,1.25,0,.7,.7,.28)||box(x,y,z,0,.35,0,1.15,.22,.25)||box(x,y,z,0,1.55,0,1.35,.2,.25))return (z>.2&&((y>2.4&&Math.abs(x)>.2)||Math.abs(y-1.3)<.12))?'cream':'body';}
    if(key==='north-star'){const a=Math.atan2(y-1.5,x),r=Math.hypot(x,y-1.5),limit=.55+.75*Math.pow(Math.abs(Math.cos(5*a)),8);if(r<limit&&Math.abs(z)<.3)return'body';}
    if(key==='pixel-alien'){const row=Math.floor((3.2-y)/.4),col=Math.floor((x+1.8)/.4);const rows=['00111100','01111110','11011011','11111111','10111101','10000001'];if(Math.abs(z)<.3&&rows[row]?.[col]==='1')return row===2?'dark':'body';}
    if(key==='star-fighter'){if(y<3.3&&y>0&&Math.abs(x)<.25+(3.2-y)*.32&&Math.abs(z)<.32)return y<.5?'accent':Math.abs(x)<.25?'cream':'body';}
    if(key==='maze-chaser'&&ellipsoid(x,y,z,0,1.5,0,1.25,1.25,.35)&&!(x>.15&&Math.abs(y-1.5-x*.5)<.35))return'body';
    if(key==='maze-ghost'&&(ellipsoid(x,y,z,0,2,0,1.15,1.1,.35)||box(x,y,z,0,1.25,0,1.15,.75,.35)))return y>2&&z>.2&&Math.abs(x)>.25?'cream':'body';
    if(key==='pixel-hero'&&(ellipsoid(x,y,z,0,2.6,0,.55,.55,.35)||box(x,y,z,0,1.6,0,.65,.6,.3)||box(x,y,z,0,.55,0,1,.25,.28)||box(x,y,z,0,1.65,0,1.25,.18,.25)))return y>2.35?'cream':y<.9?'dark':'body';
    if(key==='game-controller'){if(ellipsoid(x,y,z,0,1.4,0,1.75,.85,.45)){if(z>.3&&(Math.abs(x)>.75||Math.abs(x)<.35))return'accent';return'body';}}
    if(key==='arcade-cabinet'&&box(x,y,z,0,1.6,0,1.05,1.6,.7)){if(y>1.55&&z>.55)return'mint';if(y<.35)return'dark';return'body';}
    if(key==='birthday-cake'){
      if(box(x,y,z,0,.65,0,1.3,.65,1.05)||box(x,y,z,0,1.55,0,1,.3,.82))return Math.round(y*3)%2?'body':'cream';
      if(box(x,y,z,0,2.25,0,.1,.45,.1))return'accent';
    }
    if(key==='party-balloon'){if(ellipsoid(x,y,z,0,2.4,0,1,1.25,.55))return'body';if(Math.abs(x)<.08&&Math.abs(z)<.08&&y<1.25)return'dark';}
    if(key==='engagement-ring'){
      const radius=Math.hypot(x,y-1.35);
      if(radius>.58&&radius<.86&&Math.abs(z)<.26)return'body';
      if(y>2.08&&y<3.18&&Math.abs(x)<.72-(y-2.08)*.33&&Math.abs(z)<.55-(y-2.08)*.18)return'cream';
    }
    if(key==='proposal-ring-box'){
      if(box(x,y,z,0,.62,0,1.28,.62,1.02))return Math.abs(x)<.72&&z>.78?'cream':'body';
      if(box(x,y,z,0,1.6,-.72,1.28,.72,.18))return'dark';
      const radius=Math.hypot(x,y-1.18);
      if(radius>.27&&radius<.44&&z>.78&&z<1.18)return'cream';
    }
    if(key==='joined-rings'){
      for(const cx of [-.48,.48]){const radius=Math.hypot(x-cx,y-1.55);if(radius>.66&&radius<.9&&Math.abs(z)<.27)return cx<0?'body':'cream';}
      if(box(x,y,z,0,.16,0,1.5,.16,.55))return'dark';
    }
    if(key==='wedding-tier-cake'){
      if(box(x,y,z,0,.48,0,1.42,.48,1.08)||box(x,y,z,0,1.25,0,1.03,.3,.86)||box(x,y,z,0,1.86,0,.67,.3,.62))return Math.round(y*5)%4===0?'body':'cream';
      if(heartShape(x,y-1.28,z,.34))return'body';
    }
    if(key==='wedding-arch'){
      const outer=Math.hypot(x,y-1.7),inner=Math.hypot(x,y-1.7);
      if(y<1.75&&Math.abs(x)>.98&&Math.abs(x)<1.35&&Math.abs(z)<.34)return'cream';
      if(y>=1.65&&outer<1.36&&inner>.98&&Math.abs(z)<.34)return'cream';
      for(const [cx,cy] of [[-1.2,1.15],[-1.05,2.3],[0,3.02],[1.05,2.3],[1.2,1.15]] as [number,number][])if(ellipsoid(x,y,z,cx,cy,.2,.35,.34,.38))return cx<0?'body':'accent';
    }
    if(key==='champagne-toast'){
      for(const sx of [-.5,.5]){
        const bowl=Math.hypot((x-sx)/.55,(y-2.28)/.72);
        if(bowl<1&&bowl>.72&&Math.abs(z)<.24)return'cream';
        if(box(x,y,z,sx,1.12,0,.08,.58,.08)||box(x,y,z,sx,.47,0,.42,.1,.32))return'dark';
        if(y>1.9&&y<2.35&&Math.abs(x-sx)<.42&&Math.abs(z)<.18)return'body';
      }
      if(box(x,y,z,0,.2,0,1.15,.12,.48))return'dark';
    }
    if(key==='engagement-heart-box'){
      if(box(x,y,z,0,.3,0,1.15,.3,.78))return'dark';
      if(y>.48&&y<.7&&Math.abs(x)<1.05&&Math.abs(z)<.72)return'cream';
    }
    if(key==='grad-cap'){if(y>1.6&&y<1.9&&Math.abs(x)+Math.abs(z)<1.7)return'dark';if(box(x,y,z,0,1.35,0,.75,.3,.75))return'body';if(box(x,y,z,1.05,1.05,.4,.08,.65,.08))return'accent';}
    if(key==='grad-diploma'){if(ellipsoid(x,y,z,0,1.5,0,.58,1.4,.58))return Math.abs(y-1.5)<.15?'accent':'cream';}
    if(key==='dad-trophy'){if(ellipsoid(x,y,z,0,2.25,0,.85,.85,.55)&&!ellipsoid(x,y,z,0,2.4,0,.55,.55,.7))return'body';if(box(x,y,z,0,1.15,0,.18,.7,.18)||box(x,y,z,0,.35,0,.85,.2,.65))return'dark';}
    if(key==='dad-toolbox'){if(box(x,y,z,0,.8,0,1.45,.7,.75))return'body';if(y>1.4&&ellipsoid(x,y,z,0,1.45,0,.75,.55,.25)&&!ellipsoid(x,y,z,0,1.45,0,.45,.35,.4))return'dark';}
    if(key==='harvest-pumpkin'){if(ellipsoid(x,y,z,0,1.35,0,1.35,1.3,1.1))return Math.abs(x)<.18?'cream':'body';if(box(x,y,z,0,2.65,0,.18,.35,.18))return'accent';}
    if(key==='harvest-turkey'){if(ellipsoid(x,y,z,0,1.35,.2,.75,1.05,.65))return'body';for(let p=0;p<5;p++){const a=(-.9+p*.45);if(ellipsoid(x,y,z,Math.sin(a)*1.05,1.75,-.45,Math.abs(Math.sin(a))*.55+.25,.95,.25))return p%2?'accent':'cream';}if(ellipsoid(x,y,z,0,2.35,.45,.48,.5,.45))return'dark';}
    if(key.includes('heart')||key==='love-sign'){
      if(key==='double-heart') return heartShape(x+.65,y,z,.8)?'body':heartShape(x-.65,y+.15,z,.8)?'cream':null;
      if(key==='winged-heart'&&(heartShape(x,y,z)||((Math.abs(x)>1&&Math.abs(x)<2.2)&&Math.abs(y-1.6)<(2.3-Math.abs(x))*.5&&Math.abs(z)<.22)))return Math.abs(x)>1?'cream':'body';
      if(heartShape(x,y,z)){
        if(key==='broken-heart'&&Math.abs(x)<.16&&y<1.7)return'cream';
        if(key==='faceted-heart'&&(Math.abs(x)>.62||y<.75))return'dark';
        if(key==='mom-heart'&&y>1.5&&Math.abs(x)>.35)return'cream';
        return'body';
      }
    }
    return null;
  };
  return {bounds:{minX:-2.5,maxX:2.5,minY:0,maxY:4.2,minZ:-1.3,maxZ:1.3},classify};
}

const FONT:Record<string,string[]>=Object.fromEntries(Object.entries({
  A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','11110','10001','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','11110','10000','10000','10000','11111'],F:['11111','10000','11110','10000','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
  0:['01110','10011','10101','11001','10001','10001','01110'],1:['00100','01100','00100','00100','00100','00100','01110'],2:['01110','10001','00001','00010','00100','01000','11111'],3:['11110','00001','00001','01110','00001','00001','11110'],4:['00010','00110','01010','10010','11111','00010','00010'],5:['11111','10000','10000','11110','00001','00001','11110'],6:['01110','10000','10000','11110','10001','10001','01110'],7:['11111','00001','00010','00100','01000','01000','01000'],8:['01110','10001','10001','01110','10001','10001','01110'],9:['01110','10001','10001','01111','00001','00001','01110']
}));

export function sanitiseMessage(value:string){return value.toUpperCase().replace(/[^A-Z0-9 ]/g,'').replace(/\s+/g,' ').trimStart().slice(0,14);}
function messageModel(text:string,font:MessageFont):{classify:Classifier;bounds:Bounds}{
  const clean=sanitiseMessage(text)||'HELLO'; const width=clean.length*6-1;
  const classify:Classifier=(x,y,z)=>{const col=Math.floor(x+width/2),row=6-Math.floor(y);const ci=Math.floor(col/6),gx=col%6;const glyph=FONT[clean[ci]??''];if(gx<5&&glyph?.[row]?.[gx]==='1'){
    if(font==='stencil'&&gx===2&&row===3)return null;
    if(font==='rounded'&&(gx===0||gx===4)&&(row===0||row===6))return null;
    const depth=font==='rounded' ? .36 : .45;
    return Math.abs(z)<depth?'body':null;}return null;};
  return {bounds:{minX:-width/2-.5,maxX:width/2+.5,minY:-.2,maxY:7.4,minZ:-.7,maxZ:.7},classify};
}

function addHolder(source:{classify:Classifier;bounds:Bounds}, holder:MessageHolder):{classify:Classifier;bounds:Bounds}{
  if(holder==='flat')return source;
  const classify:Classifier=(x,y,z)=>source.classify(x,y,z) ?? (
    holder==='freestanding'
      ? (y<.18&&Math.abs(z)<1.05&&x>=source.bounds.minX&&x<=source.bounds.maxX?'dark':null)
      : (y>6.75&&Math.abs(x)>.6&&Math.abs(x)<1.25&&Math.abs(z)<.55?'dark':null)
  );
  return {bounds:{...source.bounds,minY:holder==='freestanding'?-.1:source.bounds.minY,maxY:holder==='wall'?7.8:source.bounds.maxY},classify};
}

function messageText(entry:LibraryEntry,options:LibraryBuildOptions):string{
  const key=entry.proceduralKey??entry.id;
  return sanitiseMessage(key==='love-sign'?`I LOVE ${options.message??'YOU'}`:options.message??entry.presetMessage??'HELLO')||'HELLO';
}

function wrapMessage(text:string,maxChars:number):string[]{
  const words=text.split(' ');const lines:string[]=[];let line='';
  for(const word of words){
    if(word.length>maxChars){if(line)lines.push(line);for(let i=0;i<word.length;i+=maxChars)lines.push(word.slice(i,i+maxChars));line='';continue;}
    const candidate=line?`${line} ${word}`:word;
    if(candidate.length>maxChars){if(line)lines.push(line);line=word;}else line=candidate;
  }
  if(line)lines.push(line);return lines.length?lines:['HELLO'];
}

function buildMessageBrickModel(entry:LibraryEntry,primary:string,options:LibraryBuildOptions,profile:BuildProfile):VoxelModel{
  const maxChars=profile==='efficient'?5:7;
  const lines=wrapMessage(messageText(entry,options),maxChars);
  const width=Math.max(...lines.map(line=>line.length*6-1));
  const height=lines.length*8-1;
  // Letters stay one brick deep: a standing glyph's only physical anchor is
  // the merged backing-plate brick behind it, so a second letter layer would
  // have no stud to lock onto and the release gate rejects the kit. Larger
  // sizes gain detail by scaling the whole sign up in the letter plane.
  const depth=1;
  const cells:VoxelCell[]=[];const occupied=new Set<string>();
  const add=(i:number,j:number,k:number,zone:VoxelZone,colorHex:string)=>{const key=`${i}|${j}|${k}`;if(occupied.has(key))return;occupied.add(key);cells.push({cx:i+.5,cy:j+.5,cz:k+.5,i,j,k,zone,colorHex});};
  lines.forEach((line,lineIndex)=>{
    const offset=Math.floor((width-(line.length*6-1))/2);
    [...line].forEach((char,charIndex)=>{
      const glyph=FONT[char];if(!glyph)return;
      glyph.forEach((row,rowIndex)=>[...row].forEach((on,gx)=>{
        if(on!=='1')return;
        if(options.font==='stencil'&&gx===2&&rowIndex===3)return;
        if(options.font==='rounded'&&(gx===0||gx===4)&&(rowIndex===0||rowIndex===6))return;
        const i=offset+charIndex*6+gx,j=height-(lineIndex*8+rowIndex);
        for(let k=0;k<depth;k++)add(i,j,k,'body',primary);
      }));
    });
  });
  const holder=options.holder??'freestanding';
  // Every glyph is tied into a one-plate backing. This keeps diagonal pixels,
  // separate letters and punctuation physically connected in the real kit.
  // The wall variant grows one extra row so its hanging holes sit fully above
  // the text: a hole behind a glyph's top bar removes the only brick that can
  // merge with it, leaving a stud-less piece the release gate rejects.
  const plateTop=holder==='wall'?height+2:height+1;
  for(let i=-1;i<=width;i++)for(let j=0;j<=plateTop;j++){
    const wallHole=holder==='wall'&&j>=height+1&&((i>=1&&i<=2)||(i>=width-2&&i<=width-1));
    if(!wallHole)add(i,j,-1,'dark',holder==='flat'?primary:'#202124');
  }
  if(holder==='freestanding'){
    for(let i=-1;i<=width;i++)for(let k=-1;k<=depth;k++)add(i,-1,k,'dark','#202124');
  }
  // Mini ships the base grid; Classic doubles and Showcase triples every sign
  // pixel in the letter plane. A scaled glyph row also gives floating letter
  // bars (like the top of an O) real stud support from their own lower rows.
  const pixelScale=profile==='detailed'?3:profile==='balanced'?2:1;
  if(pixelScale===1)return buildModelFromCells(cells,1,{slopes:false});
  const scaled:VoxelCell[]=[];const scaledSeen=new Set<string>();
  for(const cell of cells)for(let di=0;di<pixelScale;di++)for(let dj=0;dj<pixelScale;dj++){
    const i=cell.i*pixelScale+di,j=cell.j*pixelScale+dj;
    const key=`${i}|${j}|${cell.k}`;
    if(scaledSeen.has(key))continue;scaledSeen.add(key);
    scaled.push({...cell,i,j,cx:i+.5,cy:j+.5});
  }
  return buildModelFromCells(scaled,1,{slopes:false});
}

/** Add the shortest hidden-looking stud path between any sampled islands. */
function reinforceConnectivity(model:VoxelModel):VoxelModel{
  const layerHeight=model.layerHeight??model.size;
  const index=new Map(model.cells.map(cell=>[`${cell.i}|${cell.j}|${cell.k}`,cell]));
  const unseen=new Set(index.keys());const components:VoxelCell[][]=[];
  const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
  while(unseen.size){const seed=unseen.values().next().value as string;unseen.delete(seed);const queue=[seed],part:VoxelCell[]=[];
    while(queue.length){const key=queue.pop()!;const cell=index.get(key);if(!cell)continue;part.push(cell);for(const [di,dj,dk] of dirs){const next=`${cell.i+di}|${cell.j+dj}|${cell.k+dk}`;if(unseen.delete(next))queue.push(next);}}
    components.push(part);
  }
  if(components.length<=1)return model;
  components.sort((a,b)=>b.length-a.length);const connected=[...components[0]!];const additions:VoxelCell[]=[];
  for(const part of components.slice(1)){
    let bestA=part[0]!,bestB=connected[0]!,distance=Infinity;
    for(const a of part)for(const b of connected){const d=Math.abs(a.i-b.i)+Math.abs(a.j-b.j)+Math.abs(a.k-b.k);if(d<distance){distance=d;bestA=a;bestB=b;}}
    let i=bestA.i,j=bestA.j,k=bestA.k;
    const step=(target:number,current:number)=>current+(target===current?0:target>current?1:-1);
    while(i!==bestB.i){i=step(bestB.i,i);additions.push({...bestA,i,cx:i*model.size+model.size/2});}
    while(k!==bestB.k){k=step(bestB.k,k);additions.push({...bestA,i,k,cx:i*model.size+model.size/2,cz:k*model.size+model.size/2});}
    while(j!==bestB.j){j=step(bestB.j,j);additions.push({...bestA,i,j,k,cx:i*model.size+model.size/2,cy:j*layerHeight+layerHeight/2,cz:k*model.size+model.size/2});}
    connected.push(...part,...additions);
  }
  const unique=new Map([...model.cells,...additions].map(cell=>[`${cell.i}|${cell.j}|${cell.k}`,cell]));
  return buildModelFromCells([...unique.values()],model.size,{layerHeight});
}

function colorize(model:VoxelModel,primary:string,key:string,flowerColors:string[]=[]):VoxelModel{
  const nature=/flower|bloom|bouquet|plant|tree|lavender|blossom/.test(key);
  const palette:Record<VoxelZone,string>={body:primary,cream:'#F4F1E8',dark:'#202124',mint:'#72C9D4',accent:nature?'#2F7D3E':'#E23D28'};
  const cells=model.cells.map(c=>{
    let chosen=palette[c.zone];
    if(flowerColors.length&&c.cy>2.55&&c.zone!=='accent'&&c.zone!=='dark'){
      const slot=Math.min(flowerColors.length-1,Math.max(0,Math.floor(((c.cx+1.2)/2.4)*flowerColors.length)));
      chosen=flowerColors[slot]??chosen;
    }
    return {...c,colorHex:chosen};
  });
  const map=new Map(cells.map(c=>[`${c.i}|${c.j}|${c.k}`,c.colorHex]));
  const shell=model.shell.map(c=>({...c,colorHex:map.get(`${c.i}|${c.j}|${c.k}`),exposed:[...c.exposed]}));
  return {...model,cells,shell};
}

function sourceFor(entry:LibraryEntry,options:LibraryBuildOptions){
  const key=entry.proceduralKey??entry.id;
  const isWord=key==='custom-message'||key==='love-sign'||!!entry.presetMessage;
  let source=isWord
    ? messageModel(key==='love-sign'?`I LOVE ${sanitiseMessage(options.message??'YOU')}`:sanitiseMessage(options.message??entry.presetMessage??'HELLO'),options.font??'block')
    : entry.category==='flower' ? flower(key,options.flowerCount??5)
    : entry.category==='plant' ? plant(key)
    : entry.category==='animal' ? animal(key)
    : entry.category==='aircraft' ? aircraft(key)
    : entry.category==='space' ? spacecraft(key)
    : entry.category==='car' ? car(key)
    : icon(key);
  if(isWord)source=addHolder(source,options.holder??'freestanding');
  return {isWord,key,source};
}

export function buildProceduralLibraryPreview(entry:LibraryEntry,color:string,options:LibraryBuildOptions={}):VoxelModel{
  const {isWord,key,source}=sourceFor(entry,options);
  // Words preview at the chosen finished size so mini/classic visibly change
  // line wrapping; shapes keep one cheap preview resolution.
  if(isWord)return buildMessageBrickModel(entry,color,options,options.size??'efficient');
  return colorize(reinforceConnectivity(voxelize(source.classify,.32,source.bounds)),color,key,options.flowerColors);
}

const LIBRARY_PROFILE_RESOLUTION:Readonly<Record<BuildProfile,number>>={efficient:.28,balanced:.20,detailed:.14};

/** Deterministic geometry stage, exported so release certification can run off the buyer path. */
export function buildProceduralLibraryProfile(entry:LibraryEntry,color:string,options:LibraryBuildOptions={},profile:BuildProfile):VoxelModel{
  const {isWord,key,source}=sourceFor(entry,options);
  return isWord
    ? buildMessageBrickModel(entry,color,options,profile)
    : colorize(reinforceConnectivity(voxelize(source.classify,LIBRARY_PROFILE_RESOLUTION[profile],source.bounds)),color,key,options.flowerColors);
}

export async function buildProceduralLibraryEntry(entry:LibraryEntry,color:string,options:LibraryBuildOptions={},onProgress?:(n:number)=>void):Promise<PhotoModels>{
  const requestedProfile=options.size??'balanced';
  if(!releasedProceduralLibraryProfiles(entry).includes(requestedProfile)){
    throw new Error('This finished size is still being certified for the current parts catalog. Choose an available size.');
  }
  const models={} as PhotoModels['models'];
  const profiles=(Object.keys(LIBRARY_PROFILE_RESOLUTION) as BuildProfile[]);
  for(const [i,profile] of profiles.entries()){
    models[profile]=buildProceduralLibraryProfile(entry,color,options,profile);
    // Leave the final 35% for exact packing/assembly validation.
    onProgress?.(((i+1)/profiles.length)*.65);await Promise.resolve();
  }
  // The buyer already chose one finished size in Library. Validate and
  // advertise that profile only: assessing all six physical combinations
  // here can turn a sub-second procedural build into minutes on a phone.
  // `assessBuild` freezes both fills and WeakMap-caches the result for the
  // following screens, so this exact work is not repeated in Result.
  onProgress?.(.75);await Promise.resolve();
  const assessment=await assessBuildAsync(models[requestedProfile],color);
  if(!assessment.full.buildable&&!assessment.hollow.buildable){
    throw new Error('This size has no catalog-compatible, step-by-step build yet. Choose another finished size.');
  }
  onProgress?.(1);await Promise.resolve();
  return {availableProfiles:[requestedProfile],hasDepth:true,label:entry.name,mode:'volume',models,style:'natural'};
}
