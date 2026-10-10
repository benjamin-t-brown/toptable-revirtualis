export interface FolderNode<T> {
  name: string;
  path: string;
  folders: FolderNode<T>[];
  items: T[];
}

const UNIQUES = [
  'agnes',
  'aizul',
  'antaeus',
  'asmodeus',
  'azrael',
  'blork',
  'boris',
  'cerebov',
  'chuck',
  'crazy yiuf',
  'dispater',
  'dissolution',
  'donald',
  'duane',
  'edmund',
  'enchantress',
  'ereshkigal',
  'erica',
  'erolcha',
  'eustachio',
  'fannar',
  'frances',
  'francis',
  'frederick',
  'gastronok',
  'geryon',
  'giaggostuono',
  'gloorx vloq',
  'grum',
  'harold',
  'ignacio',
  'ijyb',
  'ilsuiw',
  'jessica',
  'jorgrun',
  'jory',
  'joseph',
  'josephine',
  'jozef',
  'kirke',
  'lom lobon',
  'louise',
  'mara',
  'margery',
  'maud',
  'maurice',
  'menkaure',
  'mennas',
  'mnoleg',
  'murray',
  'natasha',
  'nellie',
  'neqoxec',
  'nergalle',
  'nessos',
  'norbert',
  'norris',
  'polyphemus',
  'prince ribbit',
  'purgy',
  'roxanne',
  'rupert',
  'saint roka',
  'serpent of hell',
  'sigmund',
  'snorg',
  'sojobo',
  'sonja',
  'terence',
  'tiamat',
  'urug',
  'vashnia',
  'wiglaf',
  'wucad mu',
  'xtahua',
  'ynoxinul',
  'zonguldrok',
  'anubis guard',
  'apis',
  'black sun',
  'blood saint',
  'blue death',
  'cigotuvis monster',
  'dimme',
  'gelid',
  'green death',
  'grinder',
  'holy swine',
  'ironbrand convoker',
  'ironheart preserver',
  'killer klown',
  'lorocyproca',
  'psyche',
  'robin',
  'sixfirhy',
  'ufetubus',
  'worldbinder',
  'wretched star',
];

const PEOPLE: readonly (readonly [string, string])[] = [
  ['deep elf', 'People/Elves'],
  ['deformed elf', 'People/Elves'],
  ['deep dwarf', 'People/Dwarves'],
  ['deep troll', 'People/Trolls'],
  ['iron troll', 'People/Trolls'],
  ['demonspawn', 'People/Demonspawn'],
  ['hobgoblin', 'People/Goblins'],
  ['halfling', 'People/Halflings'],
  ['minotaur', 'People/Minotaurs'],
  ['octopode', 'People/Octopodes'],
  ['formicid', 'People/Formicids'],
  ['spriggan', 'People/Spriggans'],
  ['gargoyle', 'People/Gargoyles'],
  ['demigod', 'People/Demigods'],
  ['kobold', 'People/Kobolds'],
  ['centaur', 'People/Centaurs'],
  ['yaktaur', 'People/Centaurs'],
  ['merfolk', 'People/Merfolk'],
  ['mermaid', 'People/Merfolk'],
  ['gnome', 'People/Gnomes'],
  ['goblin', 'People/Goblins'],
  ['gnoll', 'People/Gnolls'],
  ['tengu', 'People/Tengu'],
  ['kenku', 'People/Tengu'],
  ['human', 'People/Humans'],
  ['dwarf', 'People/Dwarves'],
  ['troll', 'People/Trolls'],
  ['siren', 'People/Merfolk'],
  ['naga', 'People/Nagas'],
  ['ogre', 'People/Ogres'],
  ['orc', 'People/Orcs'],
  ['elf', 'People/Elves'],
  ['faun', 'People/Fauns'],
  ['satyr', 'People/Fauns'],
  ['salamander', 'People/Salamanders'],
  ['lamia', 'People/Lamia'],
  ['nymph', 'People/Nymphs'],
];

const INSECTS = new Set([
  'ant',
  'bee',
  'beetle',
  'blowfly',
  'bumblebee',
  'butterfly',
  'centipede',
  'cockroach',
  'dragonfly',
  'firefly',
  'larva',
  'midge',
  'mite',
  'mosquito',
  'moth',
  'redback',
  'scorpion',
  'spider',
  'tarantella',
  'wasp',
]);

const MAMMALS = new Set([
  'bear',
  'boar',
  'cat',
  'elephant',
  'fox',
  'grizzly',
  'dog',
  'hog',
  'hound',
  'jackal',
  'labrat',
  'pig',
  'quokka',
  'rat',
  'sheep',
  'warg',
  'wolf',
  'yak',
]);

const REPTILES = new Set([
  'adder',
  'alligator',
  'anaconda',
  'basilisk',
  'cob',
  'crocodile',
  'frog',
  'gecko',
  'gila',
  'iguana',
  'komodo',
  'lizard',
  'mamba',
  'moccasin',
  'newt',
  'python',
  'snake',
  'toad',
  'turtle',
  'viper',
]);

const WORMS = new Set(['worm']);

const SEA = new Set([
  'crab',
  'eel',
  'fish',
  'goldfish',
  'jellyfish',
  'kraken',
  'shark',
]);

const BATS = new Set(['bat', 'gigabat', 'megabat', 'microbat']);

const BIRDS = new Set(['harpy', 'phoenix', 'raven', 'shrike']);

const BEASTS = new Set(['beast', 'catoblepas', 'griffon', 'hippogriff', 'manticore', 'sphinx']);

const UNDEAD_WORDS = new Set([
  'eidolon',
  'ghost',
  'ghoul',
  'jiangshi',
  'lich',
  'mummy',
  'necrophage',
  'phantasmal',
  'phantom',
  'revenant',
  'skeletal',
  'skull',
  'spectre',
  'unborn',
  'vampire',
  'wight',
  'wraith',
]);

const DEMON_WORDS = new Set([
  'balrug',
  'cacodemon',
  'corrupter',
  'demon',
  'demonic',
  'devil',
  'executioner',
  'fiend',
  'hell',
  'hellbinder',
  'hellion',
  'hellwing',
  'imp',
  'infernal',
  'lemure',
  'manes',
  'profane',
  'quasit',
  'rakshasa',
  'reaper',
  'soul',
  'tormentor',
  'torturous',
]);

const DRAGON_WORDS = new Set(['dragon', 'drake', 'hydra', 'hydrataur', 'jormungandr', 'lindwurm', 'wyvern']);

const CELESTIAL_WORDS = new Set(['angel', 'avatar', 'cherub', 'daeva', 'holy', 'michael', 'ophan', 'seraph', 'shedu']);

const ELEMENTAL_WORDS = new Set([
  'efreet',
  'elemental',
  'lightning',
  'maelstrom',
  'raiju',
  'shock',
  'twister',
  'vapour',
  'vortex',
  'wisp',
]);

const OOZE_WORDS = new Set(['amoeba', 'blob', 'jelly', 'ooze', 'putrid', 'slime']);

const PLANT_WORDS = new Set([
  'ballistomycete',
  'briar',
  'bush',
  'deathcap',
  'dryad',
  'fungus',
  'leshy',
  'mushroom',
  'plant',
  'spore',
  'thorn',
  'treant',
  'tree',
  'vine',
  'wellspring',
  'zyme',
]);

const CONSTRUCT_WORDS = new Set([
  'battlesphere',
  'golem',
  'guardian',
  'juggernaut',
  'obelisk',
  'prism',
  'servitor',
  'spellforged',
  'statue',
  'ushabti',
]);

const ABERRATION_WORDS = new Set([
  'abomination',
  'boggart',
  'brain',
  'chaos',
  'eye',
  'eyeball',
  'horror',
  'lump',
  'mass',
  'monstrous',
  'weaver',
  'mutant',
  'shapeshifter',
  'tentacle',
  'tentacled',
]);

const GIANT_WORDS = new Set(['cyclops', 'ettin', 'giant', 'titan']);

const OBJECT_WORDS = new Set(['dummy', 'orb', 'pillar', 'spawner', 'star', 'vault']);

const ADVENTURERS = new Set(['necromancer', 'paladin', 'slave', 'warmonger', 'wizard']);

const UNIQUE_SORTED = UNIQUES.slice().sort((a, b) => b.length - a.length);
const PEOPLE_SORTED = PEOPLE.slice().sort((a, b) => b[0].length - a[0].length);

function wordsOf(name: string): string {
  return name.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasPhrase(name: string, phrase: string): boolean {
  const parts = name.split(' ');
  const want = phrase.split(' ');
  for (let i = 0; i <= parts.length - want.length; i += 1) {
    let found = true;
    for (let j = 0; j < want.length; j += 1) {
      if (parts[i + j] !== want[j]) {
        found = false;
        break;
      }
    }
    if (found) return true;
  }
  return false;
}

function hasWord(name: string, words: ReadonlySet<string>): boolean {
  for (const part of name.split(' ')) {
    if (words.has(part)) return true;
  }
  return false;
}

function starts(name: string, phrase: string): boolean {
  return name === phrase || name.startsWith(`${phrase} `);
}

export function assetFolder(asset: { name: string; class: string; folder?: string | null }): string {
  if (typeof asset.folder === 'string' && asset.folder.length > 0) return asset.folder;
  if (asset.class === 'token') return tokenFolder(asset.name);
  return '';
}

export function tokenFolder(name: string): string {
  const n = wordsOf(name);
  if (!n) return 'Other';
  if (starts(n, 'spectral')) return 'Shapes/Spectral';
  if (starts(n, 'simulacrum')) return 'Shapes/Simulacrum';
  if (starts(n, 'skeleton')) return 'Undead/Skeletons';
  if (starts(n, 'zombie')) return 'Undead/Zombies';
  if (starts(n, 'draconian') || starts(n, 'draconic')) return 'People/Draconians';
  if (starts(n, 'lorc')) return 'People/Humans';
  if (starts(n, 'shadow')) return 'Undead/Spirits';
  for (const unique of UNIQUE_SORTED) {
    if (starts(n, unique)) return 'Uniques';
  }
  for (const [phrase, folder] of PEOPLE_SORTED) {
    if (hasPhrase(n, phrase)) return folder;
  }
  if (hasPhrase(n, 'ugly thing')) return 'Aberrations';
  if (
    hasPhrase(n, 'crawling corpse') ||
    hasPhrase(n, 'curse skull') ||
    hasPhrase(n, 'curse toe') ||
    hasPhrase(n, 'death knight') ||
    hasPhrase(n, 'bog body') ||
    hasPhrase(n, 'drowned soul') ||
    hasPhrase(n, 'lost soul') ||
    hasPhrase(n, 'rotting hulk')
  ) {
    return 'Undead';
  }
  if (hasWord(n, UNDEAD_WORDS)) return 'Undead';
  if (hasWord(n, DEMON_WORDS)) return 'Demons';
  if (hasWord(n, DRAGON_WORDS)) return 'Dragons';
  if (hasWord(n, CELESTIAL_WORDS)) return 'Celestials';
  if (hasWord(n, ELEMENTAL_WORDS)) return 'Elementals';
  if (hasWord(n, OOZE_WORDS)) return 'Oozes';
  if (hasWord(n, PLANT_WORDS)) return 'Plants';
  if (hasWord(n, CONSTRUCT_WORDS)) return 'Constructs';
  if (hasWord(n, ABERRATION_WORDS)) return 'Aberrations';
  if (starts(n, 'ice form')) return 'Elementals';
  if (hasWord(n, INSECTS)) return 'Animals/Insects';
  if (hasWord(n, BATS)) return 'Animals/Bats';
  if (hasWord(n, BIRDS)) return 'Animals/Birds';
  if (hasWord(n, REPTILES)) return 'Animals/Reptiles';
  if (hasWord(n, SEA)) return 'Animals/Sea life';
  if (hasWord(n, MAMMALS)) return 'Animals/Mammals';
  if (hasWord(n, BEASTS)) return 'Animals/Beasts';
  if (hasWord(n, WORMS)) return 'Animals/Worms';
  if (hasWord(n, GIANT_WORDS)) return 'Giants';
  if (hasPhrase(n, 'block of ice') || hasWord(n, OBJECT_WORDS)) return 'Objects';
  if (hasWord(n, ADVENTURERS)) return 'People/Adventurers';
  return 'Other';
}

export function groupByFolder<T extends { name: string }>(items: readonly T[], folderOf: (item: T) => string): FolderNode<T> {
  const root: FolderNode<T> = { name: '', path: '', folders: [], items: [] };
  const nodes = new Map<string, FolderNode<T>>([['', root]]);
  const ensure = (path: string): FolderNode<T> => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const parts = path.split('/');
    const name = parts[parts.length - 1] ?? path;
    const parent = ensure(parts.slice(0, -1).join('/'));
    const node: FolderNode<T> = { name, path, folders: [], items: [] };
    parent.folders.push(node);
    nodes.set(path, node);
    return node;
  };
  for (const item of items) {
    const folder = folderOf(item).replace(/^\/+|\/+$/g, '');
    const node = folder ? ensure(folder) : root;
    node.items.push(item);
  }
  const sortNode = (node: FolderNode<T>): void => {
    node.folders.sort((a, b) => {
      if (a.name === 'Other') return 1;
      if (b.name === 'Other') return -1;
      return a.name.localeCompare(b.name);
    });
    node.items.sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of node.folders) sortNode(folder);
  };
  sortNode(root);
  return root;
}

export function folderSize<T>(node: FolderNode<T>): number {
  let count = node.items.length;
  for (const folder of node.folders) count += folderSize(folder);
  return count;
}
