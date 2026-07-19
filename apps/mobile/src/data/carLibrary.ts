/** Curated, trademark-neutral objects designed directly on the brick grid. */

export type LibraryCategory = 'car' | 'flower' | 'plant' | 'aircraft' | 'space' | 'holiday' | 'arcade' | 'heart' | 'gift' | 'animal' | 'object';
export type LibraryEra = 'classic' | 'modern';
export type MessageFont = 'block' | 'rounded' | 'stencil';
export type LibraryTheme = 'romance' | 'engagement' | 'wedding' | 'birthday' | 'graduation' | 'fathers-day' | 'mothers-day' | 'thanksgiving' | 'christmas';

/** Kept as the sole approved external demo reference for regression/audit checks. */
export const APPROVED_DEMO_CAR = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb';

export interface LibraryEntry {
  id: string;
  name: string;
  category: LibraryCategory;
  era?: LibraryEra;
  tags: string[];
  meshUrl: string | null;
  thumbnailUrl?: string;
  /** Deterministic brick-native generator; unlike a mesh, this cannot lose thin details. */
  proceduralKey?: string;
  defaultColor: string;
  icon?: string;
  theme?: LibraryTheme;
  presetMessage?: string;
  supportsHolder?: boolean;
  flowerSlots?: number;
  seed?: boolean;
}

const item = (
  id: string,
  name: string,
  category: LibraryCategory,
  color: string,
  icon: string,
  tags: string[] = [],
  era?: LibraryEra,
): LibraryEntry => ({
  category, defaultColor: color, era, icon, id, meshUrl: null,
  name, proceduralKey: id, seed: true, tags,
});

export const LIBRARY_SEED: LibraryEntry[] = [
  item('apex-wedge', 'Apex Wedge', 'car', '#D62828', '🏎️', ['low', 'exotic'], 'modern'),
  item('night-runner', 'Night Runner', 'car', '#151515', '🏎️', ['turbo', 'street'], 'modern'),
  item('track-arrow', 'Track Arrow', 'car', '#F5B700', '🏎️', ['wing', 'circuit'], 'modern'),
  item('open-roadster', 'Open Roadster', 'car', '#1769AA', '🏎️', ['open-top'], 'modern'),
  item('retro-rally', 'Retro Rally Coupe', 'car', '#E8E8E8', '🏎️', ['boxy', 'rally'], 'classic'),
  item('classic-gt', 'Classic Grand Tourer', 'car', '#1B1B1B', '🏎️', ['curved', 'touring'], 'classic'),
  item('classic-streamliner', '1930s Streamliner', 'car', '#7A2431', '🏎️', ['art-deco', 'long'], 'classic'),
  item('classic-open-tourer', '1930s Open Tourer', 'car', '#214E76', '🏎️', ['open-top', 'touring'], 'classic'),
  item('classic-city-micro', '1950s City Microcar', 'car', '#65B7A6', '🚗', ['tiny', 'round'], 'classic'),
  item('classic-muscle', '1960s Muscle Coupe', 'car', '#B51F3A', '🏎️', ['power', 'coupe'], 'classic'),
  item('classic-beach-buggy', '1970s Beach Buggy', 'car', '#F4C430', '🏎️', ['open-top', 'beach'], 'classic'),
  item('classic-wedge', '1980s Wedge Coupe', 'car', '#D7263D', '🏎️', ['retro', 'wedge'], 'classic'),
  item('modern-city-ev', 'Electric City Car', 'car', '#72C9D4', '🚙', ['electric', 'compact'], 'modern'),
  item('modern-sport-ev', 'Electric Sports Coupe', 'car', '#6C3DBA', '🏎️', ['electric', 'fast'], 'modern'),
  item('modern-luxury-gt', 'Modern Luxury GT', 'car', '#202124', '🏎️', ['luxury', 'touring'], 'modern'),
  item('modern-rally', 'Modern Rally Hatch', 'car', '#F4F1E8', '🏎️', ['rally', 'hatch'], 'modern'),
  item('modern-track', 'Carbon Track Special', 'car', '#151515', '🏎️', ['track', 'wing'], 'modern'),
  item('modern-speedster', 'Open Electric Speedster', 'car', '#F28C28', '🏎️', ['electric', 'open-top'], 'modern'),

  item('rose-bloom', 'Velvet Rose', 'flower', '#B51F3A', '🌹', ['romantic']),
  item('tulip-bloom', 'Spring Tulip', 'flower', '#F05A7E', '🌷', ['spring']),
  item('sunflower-bloom', 'Giant Sunflower', 'flower', '#F4C430', '🌻', ['bright']),
  item('orchid-bloom', 'Exotic Orchid', 'flower', '#A64AC9', '🌸', ['exotic']),
  item('lotus-bloom', 'Floating Lotus', 'flower', '#F7A8C4', '🪷', ['calm']),
  item('wild-bouquet', 'Wildflower Bouquet', 'flower', '#ED6A5A', '💐', ['gift']),
  item('peony-bloom', 'Garden Peony', 'flower', '#F4A6C1', '🌸', ['layered', 'garden']),
  item('lily-bloom', 'Oriental Lily', 'flower', '#F4F1E8', '🌺', ['lily', 'exotic']),
  item('dahlia-bloom', 'Dahlia Star', 'flower', '#C83E7B', '🌸', ['layered', 'star']),
  item('daffodil-bloom', 'Spring Daffodil', 'flower', '#F4C430', '🌼', ['spring', 'trumpet']),
  item('poppy-bloom', 'Red Poppy', 'flower', '#D7263D', '🌺', ['wildflower']),
  item('daisy-bloom', 'White Daisy', 'flower', '#F4F1E8', '🌼', ['wildflower']),
  item('iris-bloom', 'Purple Iris', 'flower', '#6C3DBA', '🪷', ['garden']),
  item('hibiscus-bloom', 'Tropical Hibiscus', 'flower', '#F05A7E', '🌺', ['tropical']),
  item('lavender-bunch', 'Lavender Bunch', 'flower', '#8067B7', '🪻', ['fragrant', 'bunch']),
  item('cherry-blossom', 'Cherry Blossom Branch', 'flower', '#F7B6D2', '🌸', ['branch', 'spring']),
  { ...item('mixed-bouquet', 'Florist Mixed Bouquet', 'flower', '#F05A7E', '💐', ['bouquet', 'florist']), flowerSlots: 5 },
  { ...item('tulip-bouquet', 'Tulip Bouquet', 'flower', '#F28C28', '💐', ['bouquet', 'tulip']), flowerSlots: 5 },

  item('plant-cactus', 'Desert Cactus', 'plant', '#3D8A52', '🌵', ['desert', 'pot']),
  item('plant-succulent', 'Potted Succulent', 'plant', '#65A765', '🪴', ['indoor', 'pot']),
  item('plant-monstera', 'Monstera Plant', 'plant', '#287A45', '🪴', ['indoor', 'leaf']),
  item('plant-snake', 'Snake Plant', 'plant', '#3E8B57', '🪴', ['indoor', 'pot']),
  item('plant-bonsai', 'Mini Bonsai', 'plant', '#386641', '🌳', ['tree', 'pot']),
  item('tree-oak', 'Mighty Oak', 'plant', '#4F772D', '🌳', ['tree', 'deciduous']),
  item('tree-pine', 'Mountain Pine', 'plant', '#2D6A4F', '🌲', ['tree', 'evergreen']),
  item('tree-palm', 'Tropical Palm', 'plant', '#40916C', '🌴', ['tree', 'tropical']),
  item('tree-cherry', 'Blossoming Tree', 'plant', '#F4A6C1', '🌸', ['tree', 'spring']),
  item('tree-autumn', 'Autumn Maple', 'plant', '#E76F2E', '🍁', ['tree', 'autumn']),

  // Animals: recognizable, trademark-neutral species and breed-inspired forms.
  item('dog-retriever', 'Golden Retriever', 'animal', '#C89245', '🐕', ['dog', 'friendly', 'family']),
  item('dog-bulldog', 'French Bulldog', 'animal', '#B99675', '🐕', ['dog', 'compact', 'small']),
  item('dog-dachshund', 'Dachshund', 'animal', '#8B4E2E', '🐕', ['dog', 'long', 'small']),
  item('dog-poodle', 'Poodle', 'animal', '#F4F1E8', '🐩', ['dog', 'curly', 'elegant']),
  item('dog-husky', 'Husky', 'animal', '#8F969D', '🐕', ['dog', 'snow', 'pointed ears']),
  item('dog-beagle', 'Beagle', 'animal', '#A96B3D', '🐕', ['dog', 'floppy ears', 'family']),
  item('cat-tabby', 'Tabby Cat', 'animal', '#9B7653', '🐈', ['cat', 'striped', 'pet']),
  item('cat-black', 'Black Cat', 'animal', '#202124', '🐈‍⬛', ['cat', 'sleek', 'pet']),
  item('cat-siamese', 'Siamese Cat', 'animal', '#E8D5B5', '🐈', ['cat', 'pointed', 'pet']),
  item('cat-longhair', 'Longhair Cat', 'animal', '#D4A574', '🐈', ['cat', 'fluffy', 'pet']),
  item('cat-sphynx', 'Hairless Cat', 'animal', '#D8A792', '🐈', ['cat', 'slender', 'pet']),
  item('bigcat-lion', 'Lion', 'animal', '#C7933E', '🦁', ['big cat', 'safari', 'mane']),
  item('bigcat-tiger', 'Tiger', 'animal', '#E7812B', '🐅', ['big cat', 'safari', 'striped']),
  item('bigcat-jaguar', 'Jaguar', 'animal', '#D6A23D', '🐆', ['big cat', 'jungle', 'spotted']),
  item('bigcat-cheetah', 'Cheetah', 'animal', '#D9B24C', '🐆', ['big cat', 'safari', 'fast']),
  item('bigcat-snow-leopard', 'Snow Leopard', 'animal', '#D9DEE3', '🐆', ['big cat', 'mountain', 'spotted']),
  item('safari-elephant', 'African Elephant', 'animal', '#858B8F', '🐘', ['safari', 'large', 'trunk']),
  item('safari-giraffe', 'Giraffe', 'animal', '#D9A441', '🦒', ['safari', 'tall', 'spotted']),
  item('safari-zebra', 'Zebra', 'animal', '#F4F4F1', '🦓', ['safari', 'striped']),
  item('safari-rhino', 'Rhinoceros', 'animal', '#7C8588', '🦏', ['safari', 'large', 'horn']),
  item('safari-hippo', 'Hippopotamus', 'animal', '#8F7F88', '🦛', ['safari', 'large', 'river']),
  item('farm-pig', 'Farm Pig', 'animal', '#F2A7A0', '🐖', ['farm', 'pink']),
  item('farm-horse', 'Horse', 'animal', '#6F452D', '🐎', ['farm', 'riding']),
  item('farm-pony', 'Pony', 'animal', '#A87349', '🐴', ['farm', 'small', 'riding']),
  item('farm-cow', 'Dairy Cow', 'animal', '#F4F4F1', '🐄', ['farm', 'spotted']),
  item('farm-sheep', 'Woolly Sheep', 'animal', '#F4F1E8', '🐑', ['farm', 'woolly']),
  item('farm-goat', 'Mountain Goat', 'animal', '#B7A58E', '🐐', ['farm', 'horns']),
  item('farm-rabbit', 'Rabbit', 'animal', '#C9B6A4', '🐇', ['farm', 'long ears']),
  item('dino-trex', 'Tyrant Dinosaur', 'animal', '#4E7C45', '🦖', ['dinosaur', 'carnivore', 'large']),
  item('dino-triceratops', 'Three-Horn Dinosaur', 'animal', '#66845A', '🦕', ['dinosaur', 'horned']),
  item('dino-stegosaurus', 'Plated Dinosaur', 'animal', '#63835C', '🦕', ['dinosaur', 'plates']),
  item('dino-brachiosaurus', 'Long-Neck Dinosaur', 'animal', '#5E8062', '🦕', ['dinosaur', 'long neck']),
  item('dino-raptor', 'Swift Raptor Dinosaur', 'animal', '#66784A', '🦖', ['dinosaur', 'carnivore', 'fast']),

  item('jet-classic-swept', 'Classic Swept-Wing Fighter', 'aircraft', '#9AA0A6', '✈️', ['fighter', 'classic']),
  item('jet-delta', 'Delta-Wing Interceptor', 'aircraft', '#C4C8CC', '✈️', ['fighter', 'delta']),
  item('jet-carrier', 'Carrier Fighter', 'aircraft', '#61758A', '✈️', ['fighter', 'carrier']),
  item('jet-twin-tail', 'Twin-Tail Air-Superiority Jet', 'aircraft', '#66786C', '✈️', ['fighter', 'twin-tail']),
  item('jet-stealth', 'Stealth Fighter', 'aircraft', '#24272B', '✈️', ['fighter', 'stealth']),
  item('jet-future', 'Future Concept Fighter', 'aircraft', '#505A64', '✈️', ['fighter', 'future']),
  item('jet-trainer', 'Bright Jet Trainer', 'aircraft', '#F28C28', '✈️', ['trainer', 'display']),
  item('jet-display', 'Aerobatic Display Jet', 'aircraft', '#1769AA', '✈️', ['aerobatic', 'display']),

  item('rocket-early', 'Early Orbital Rocket', 'space', '#F4F1E8', '🚀', ['space', 'historic']),
  item('rocket-moon', 'Moon-Era Heavy Rocket', 'space', '#F4F1E8', '🚀', ['space', 'moon']),
  item('rocket-shuttle', 'Winged Orbital Vehicle', 'space', '#F4F1E8', '🚀', ['space', 'winged']),
  item('rocket-satellite', 'Satellite Launcher', 'space', '#D8DDE8', '🚀', ['space', 'satellite']),
  item('rocket-modern', 'Reusable Modern Rocket', 'space', '#F4F1E8', '🚀', ['space', 'reusable']),
  item('rocket-heavy', 'Heavy Triple-Core Rocket', 'space', '#E8E8E8', '🚀', ['space', 'heavy']),
  item('rocket-lunar', 'Lunar Lander', 'space', '#D8B45A', '🛸', ['space', 'lander']),
  item('rocket-mars', 'Mars Explorer', 'space', '#C26B3A', '🪐', ['space', 'rover']),
  item('rocket-future', 'Future Deep-Space Ship', 'space', '#BFC7D5', '🚀', ['space', 'future']),

  item('winter-tree', 'Festive Tree', 'holiday', '#237A3B', '🎄', ['christmas']),
  item('snow-friend', 'Snow Friend', 'holiday', '#F4F4F1', '☃️', ['winter']),
  item('gift-box', 'Ribbon Gift', 'holiday', '#C9263E', '🎁', ['present']),
  item('candy-cane', 'Candy Cane', 'holiday', '#D9272E', '🍬', ['sweet']),
  item('winter-stocking', 'Winter Stocking', 'holiday', '#C9263E', '🧦', ['fireplace']),
  item('tree-bauble', 'Shining Bauble', 'holiday', '#D9A514', '🟡', ['ornament']),
  item('ginger-friend', 'Gingerbread Friend', 'holiday', '#A95E2D', '🍪', ['cookie']),
  item('north-star', 'North Star', 'holiday', '#F4C430', '⭐', ['decoration']),

  item('pixel-alien', 'Pixel Alien', 'arcade', '#65D46E', '👾', ['retro', 'space']),
  item('star-fighter', 'Star Fighter', 'arcade', '#D8DDE8', '🚀', ['space']),
  item('maze-chaser', 'Maze Chaser', 'arcade', '#F6C90E', '🟡', ['maze', 'retro']),
  item('maze-ghost', 'Maze Ghost', 'arcade', '#E9415E', '👻', ['maze', 'retro']),
  item('pixel-hero', 'Pixel Hero', 'arcade', '#2675D8', '🦸', ['platform', 'retro']),
  item('game-controller', 'Classic Controller', 'arcade', '#333844', '🎮', ['gaming']),
  item('arcade-cabinet', 'Mini Arcade Cabinet', 'arcade', '#472B7A', '🕹️', ['cabinet']),

  item('classic-heart', 'Classic Heart', 'heart', '#D7263D', '❤️', ['love']),
  item('faceted-heart', 'Faceted Heart', 'heart', '#E63973', '💖', ['gem']),
  item('double-heart', 'Double Hearts', 'heart', '#EF476F', '💕', ['couple']),
  item('winged-heart', 'Winged Heart', 'heart', '#D7263D', '💘', ['wings']),
  item('broken-heart', 'Mended Heart', 'heart', '#D7263D', '💔', ['mended']),
  item('love-sign', 'I LOVE ... Sign', 'heart', '#D7263D', '❤️', ['personalise']),

  // Occasion collections: useful objects plus brick-safe word art.
  { ...item('word-be-mine', 'BE MINE Sign', 'gift', '#D7263D', '❤️', ['words', 'sign']), theme: 'romance', presetMessage: 'BE MINE', supportsHolder: true },
  { ...item('word-xoxo', 'XOXO Sign', 'gift', '#EF476F', '💌', ['words', 'sign']), theme: 'romance', presetMessage: 'XOXO', supportsHolder: true },
  { ...item('rose-bouquet-large', 'Dozen Rose Bouquet', 'flower', '#B51F3A', '💐', ['bouquet', 'flowers']), theme: 'romance', flowerSlots: 5 },

  { ...item('engagement-ring', 'Proposal Diamond Ring', 'gift', '#F4C430', '💍', ['proposal', 'diamond', 'ring']), theme: 'engagement' },
  { ...item('proposal-ring-box', 'Open Ring Box', 'gift', '#B51F3A', '💍', ['proposal', 'ring', 'box']), theme: 'engagement' },
  { ...item('engagement-heart-box', 'Engagement Heart Keepsake', 'heart', '#F05A7E', '💖', ['proposal', 'heart', 'keepsake']), theme: 'engagement' },
  { ...item('engagement-bouquet', 'Proposal Rose Posy', 'flower', '#F05A7E', '💐', ['proposal', 'bouquet', 'flowers']), theme: 'engagement', flowerSlots: 5 },
  { ...item('word-marry-me', 'MARRY ME Sign', 'gift', '#D7263D', '💍', ['proposal', 'words', 'sign']), theme: 'engagement', presetMessage: 'MARRY ME', supportsHolder: true },
  { ...item('word-we-said-yes', 'WE SAID YES Sign', 'gift', '#F4C430', '✨', ['proposal', 'words', 'sign']), theme: 'engagement', presetMessage: 'WE SAID YES', supportsHolder: true },

  { ...item('joined-rings', 'Joined Wedding Rings', 'gift', '#F4C430', '💍', ['ceremony', 'rings']), theme: 'wedding' },
  { ...item('wedding-tier-cake', 'Three-Tier Wedding Cake', 'gift', '#F4F4F1', '🎂', ['ceremony', 'cake']), theme: 'wedding' },
  { ...item('wedding-arch', 'Flower Wedding Arch', 'gift', '#F4F4F1', '💐', ['ceremony', 'arch', 'flowers']), theme: 'wedding' },
  { ...item('champagne-toast', 'Wedding Toast', 'gift', '#F4C430', '🥂', ['celebration', 'glasses']), theme: 'wedding' },
  { ...item('wedding-bouquet', 'Bridal Bouquet', 'flower', '#F4F4F1', '💐', ['ceremony', 'bridal', 'bouquet']), theme: 'wedding', flowerSlots: 5 },
  { ...item('wedding-getaway', 'Wedding Getaway Car', 'car', '#F4F4F1', '🚗', ['ceremony', 'car', 'classic']), theme: 'wedding', era: 'classic' },
  { ...item('word-just-married', 'JUST MARRIED Sign', 'gift', '#F4F4F1', '💒', ['ceremony', 'words', 'sign']), theme: 'wedding', presetMessage: 'JUST MARRIED', supportsHolder: true },
  { ...item('word-couple-names', 'Couple Names Sign', 'gift', '#D7263D', '♥', ['ceremony', 'names', 'words', 'sign']), theme: 'wedding', presetMessage: 'A AND B', supportsHolder: true },

  { ...item('birthday-cake', 'Celebration Cake', 'gift', '#F05A7E', '🎂', ['cake', 'party']), theme: 'birthday' },
  { ...item('party-balloon', 'Party Balloon', 'gift', '#1769AA', '🎈', ['party', 'balloon']), theme: 'birthday' },
  { ...item('word-happy-bday', 'HAPPY BDAY Sign', 'gift', '#F28C28', '🎉', ['words', 'sign']), theme: 'birthday', presetMessage: 'HAPPY BDAY', supportsHolder: true },
  { ...item('word-age', 'Custom Age Sign', 'gift', '#6C3DBA', '18', ['numbers', 'sign']), theme: 'birthday', presetMessage: '18', supportsHolder: true },

  { ...item('grad-cap', 'Graduation Cap', 'gift', '#1B1B1B', '🎓', ['school', 'cap']), theme: 'graduation' },
  { ...item('grad-diploma', 'Diploma Scroll', 'gift', '#F4F1E8', '📜', ['school', 'diploma']), theme: 'graduation' },
  { ...item('word-congrats-grad', 'CONGRATS GRAD Sign', 'gift', '#1769AA', '🎓', ['words', 'sign']), theme: 'graduation', presetMessage: 'CONGRATS GRAD', supportsHolder: true },
  { ...item('word-class-year', 'Class Year Sign', 'gift', '#F4C430', '26', ['numbers', 'sign']), theme: 'graduation', presetMessage: 'CLASS 26', supportsHolder: true },

  { ...item('dad-trophy', 'Number One Trophy', 'gift', '#F4C430', '🏆', ['trophy']), theme: 'fathers-day' },
  { ...item('dad-toolbox', 'Mini Toolbox', 'gift', '#D7263D', '🧰', ['tools']), theme: 'fathers-day' },
  { ...item('word-best-dad', 'BEST DAD Sign', 'gift', '#1769AA', '💙', ['words', 'sign']), theme: 'fathers-day', presetMessage: 'BEST DAD', supportsHolder: true },

  { ...item('mother-bouquet', 'Mother’s Bouquet', 'flower', '#F05A7E', '💐', ['bouquet', 'flowers']), theme: 'mothers-day', flowerSlots: 5 },
  { ...item('word-love-mom', 'LOVE YOU MOM Sign', 'gift', '#D7263D', '💗', ['words', 'sign']), theme: 'mothers-day', presetMessage: 'LOVE YOU MOM', supportsHolder: true },
  { ...item('mom-heart', 'Blooming Heart', 'heart', '#F05A7E', '💖', ['heart', 'flowers']), theme: 'mothers-day' },

  { ...item('harvest-pumpkin', 'Harvest Pumpkin', 'gift', '#F28C28', '🎃', ['harvest']), theme: 'thanksgiving' },
  { ...item('harvest-turkey', 'Harvest Bird', 'gift', '#8B5A2B', '🦃', ['harvest', 'bird']), theme: 'thanksgiving' },
  { ...item('word-thankful', 'THANKFUL Sign', 'gift', '#8B5A2B', '🍂', ['words', 'sign']), theme: 'thanksgiving', presetMessage: 'THANKFUL', supportsHolder: true },

  { ...item('word-merry', 'MERRY Sign', 'holiday', '#D7263D', '🎄', ['words', 'sign']), theme: 'christmas', presetMessage: 'MERRY', supportsHolder: true },
  { ...item('word-ho-ho-ho', 'HO HO HO Sign', 'holiday', '#D7263D', '🎅', ['words', 'sign']), theme: 'christmas', presetMessage: 'HO HO HO', supportsHolder: true },
];

export const LIBRARY_CATEGORIES: { id: 'all' | LibraryCategory | LibraryTheme | 'message'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'car', label: 'Sports cars' },
  { id: 'flower', label: 'Flowers' }, { id: 'plant', label: 'Plants & trees' },
  { id: 'animal', label: 'Animals' },
  { id: 'aircraft', label: 'Fighter jets' }, { id: 'space', label: 'Space' },
  { id: 'holiday', label: 'Christmas' },
  { id: 'arcade', label: 'Arcade' }, { id: 'heart', label: 'Hearts' },
  { id: 'message', label: 'Your message' },
  { id: 'romance', label: 'Romance' }, { id: 'engagement', label: 'Engagement' },
  { id: 'wedding', label: 'Wedding' }, { id: 'birthday', label: 'Birthday' },
  { id: 'graduation', label: 'Graduation' }, { id: 'fathers-day', label: "Father's Day" },
  { id: 'mothers-day', label: "Mother's Day" }, { id: 'thanksgiving', label: 'Thanksgiving' },
];

export const LIBRARY_COLORS = [
  '#D7263D', '#F05A7E', '#F4C430', '#F28C28', '#237A3B', '#1769AA',
  '#6C3DBA', '#F4F4F1', '#8B5A2B', '#1B1B1B',
];
