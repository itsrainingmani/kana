export const FONT_OPTIONS = [
  {
    id: 'gothic',
    label: 'Gothic',
    className: 'font-gothic'
  },
  {
    id: 'mincho',
    label: 'Mincho',
    className: 'font-mincho'
  },
  {
    id: 'rounded',
    label: 'Rounded',
    className: 'font-rounded'
  },
  {
    id: 'magic',
    label: 'Magic',
    className: 'font-magic'
  },
  {
    id: 'dot',
    label: 'Dot',
    className: 'font-dot'
  }
];

export const ROW_OPTIONS = [
  { id: 'vowels', label: 'Vowels' },
  { id: 'k', label: 'K Row' },
  { id: 's', label: 'S Row' },
  { id: 't', label: 'T Row' },
  { id: 'n', label: 'N Row' },
  { id: 'h', label: 'H Row' },
  { id: 'm', label: 'M Row' },
  { id: 'y', label: 'Y Row' },
  { id: 'r', label: 'R Row' },
  { id: 'w', label: 'W Row' },
  { id: 'g', label: 'G Row' },
  { id: 'z', label: 'Z Row' },
  { id: 'd', label: 'D Row' },
  { id: 'b', label: 'B Row' },
  { id: 'p', label: 'P Row' }
];

export const GROUP_OPTIONS = [
  { id: 'base', label: 'Base' },
  { id: 'dakuten', label: 'Dakuten' },
  { id: 'handakuten', label: 'Handakuten' },
  { id: 'combination', label: 'Combination' }
];

const BASE_ROWS = [
  ['vowels', [
    ['a', 'a', 'あ', 'ア'],
    ['i', 'i', 'い', 'イ'],
    ['u', 'u', 'う', 'ウ'],
    ['e', 'e', 'え', 'エ'],
    ['o', 'o', 'お', 'オ']
  ]],
  ['k', [
    ['ka', 'ka', 'か', 'カ'],
    ['ki', 'ki', 'き', 'キ'],
    ['ku', 'ku', 'く', 'ク'],
    ['ke', 'ke', 'け', 'ケ'],
    ['ko', 'ko', 'こ', 'コ']
  ]],
  ['s', [
    ['sa', 'sa', 'さ', 'サ'],
    ['shi', 'shi', 'し', 'シ'],
    ['su', 'su', 'す', 'ス'],
    ['se', 'se', 'せ', 'セ'],
    ['so', 'so', 'そ', 'ソ']
  ]],
  ['t', [
    ['ta', 'ta', 'た', 'タ'],
    ['chi', 'chi', 'ち', 'チ'],
    ['tsu', 'tsu', 'つ', 'ツ'],
    ['te', 'te', 'て', 'テ'],
    ['to', 'to', 'と', 'ト']
  ]],
  ['n', [
    ['na', 'na', 'な', 'ナ'],
    ['ni', 'ni', 'に', 'ニ'],
    ['nu', 'nu', 'ぬ', 'ヌ'],
    ['ne', 'ne', 'ね', 'ネ'],
    ['no', 'no', 'の', 'ノ']
  ]],
  ['h', [
    ['ha', 'ha', 'は', 'ハ'],
    ['hi', 'hi', 'ひ', 'ヒ'],
    ['fu', 'fu', 'ふ', 'フ'],
    ['he', 'he', 'へ', 'ヘ'],
    ['ho', 'ho', 'ほ', 'ホ']
  ]],
  ['m', [
    ['ma', 'ma', 'ま', 'マ'],
    ['mi', 'mi', 'み', 'ミ'],
    ['mu', 'mu', 'む', 'ム'],
    ['me', 'me', 'め', 'メ'],
    ['mo', 'mo', 'も', 'モ']
  ]],
  ['y', [
    ['ya', 'ya', 'や', 'ヤ'],
    ['yu', 'yu', 'ゆ', 'ユ'],
    ['yo', 'yo', 'よ', 'ヨ']
  ]],
  ['r', [
    ['ra', 'ra', 'ら', 'ラ'],
    ['ri', 'ri', 'り', 'リ'],
    ['ru', 'ru', 'る', 'ル'],
    ['re', 're', 'れ', 'レ'],
    ['ro', 'ro', 'ろ', 'ロ']
  ]],
  ['w', [
    ['wa', 'wa', 'わ', 'ワ'],
    ['wo', 'wo', 'を', 'ヲ'],
    ['n', 'n', 'ん', 'ン']
  ]]
];

const DAKUTEN_ROWS = [
  ['g', [
    ['ga', 'ga', 'が', 'ガ'],
    ['gi', 'gi', 'ぎ', 'ギ'],
    ['gu', 'gu', 'ぐ', 'グ'],
    ['ge', 'ge', 'げ', 'ゲ'],
    ['go', 'go', 'ご', 'ゴ']
  ]],
  ['z', [
    ['za', 'za', 'ざ', 'ザ'],
    ['ji-s', 'ji', 'じ', 'ジ'],
    ['zu-s', 'zu', 'ず', 'ズ'],
    ['ze', 'ze', 'ぜ', 'ゼ'],
    ['zo', 'zo', 'ぞ', 'ゾ']
  ]],
  ['d', [
    ['da', 'da', 'だ', 'ダ'],
    ['ji-t', 'ji', 'ぢ', 'ヂ'],
    ['zu-t', 'zu', 'づ', 'ヅ'],
    ['de', 'de', 'で', 'デ'],
    ['do', 'do', 'ど', 'ド']
  ]],
  ['b', [
    ['ba', 'ba', 'ば', 'バ'],
    ['bi', 'bi', 'び', 'ビ'],
    ['bu', 'bu', 'ぶ', 'ブ'],
    ['be', 'be', 'べ', 'ベ'],
    ['bo', 'bo', 'ぼ', 'ボ']
  ]]
];

const HANDAKUTEN_ROWS = [
  ['p', [
    ['pa', 'pa', 'ぱ', 'パ'],
    ['pi', 'pi', 'ぴ', 'ピ'],
    ['pu', 'pu', 'ぷ', 'プ'],
    ['pe', 'pe', 'ぺ', 'ペ'],
    ['po', 'po', 'ぽ', 'ポ']
  ]]
];

const COMBINATION_ROWS = [
  ['k', [
    ['kya', 'kya', 'きゃ', 'キャ'],
    ['kyu', 'kyu', 'きゅ', 'キュ'],
    ['kyo', 'kyo', 'きょ', 'キョ']
  ]],
  ['s', [
    ['sha', 'sha', 'しゃ', 'シャ'],
    ['shu', 'shu', 'しゅ', 'シュ'],
    ['sho', 'sho', 'しょ', 'ショ']
  ]],
  ['t', [
    ['cha', 'cha', 'ちゃ', 'チャ'],
    ['chu', 'chu', 'ちゅ', 'チュ'],
    ['cho', 'cho', 'ちょ', 'チョ']
  ]],
  ['n', [
    ['nya', 'nya', 'にゃ', 'ニャ'],
    ['nyu', 'nyu', 'にゅ', 'ニュ'],
    ['nyo', 'nyo', 'にょ', 'ニョ']
  ]],
  ['h', [
    ['hya', 'hya', 'ひゃ', 'ヒャ'],
    ['hyu', 'hyu', 'ひゅ', 'ヒュ'],
    ['hyo', 'hyo', 'ひょ', 'ヒョ']
  ]],
  ['m', [
    ['mya', 'mya', 'みゃ', 'ミャ'],
    ['myu', 'myu', 'みゅ', 'ミュ'],
    ['myo', 'myo', 'みょ', 'ミョ']
  ]],
  ['r', [
    ['rya', 'rya', 'りゃ', 'リャ'],
    ['ryu', 'ryu', 'りゅ', 'リュ'],
    ['ryo', 'ryo', 'りょ', 'リョ']
  ]],
  ['g', [
    ['gya', 'gya', 'ぎゃ', 'ギャ'],
    ['gyu', 'gyu', 'ぎゅ', 'ギュ'],
    ['gyo', 'gyo', 'ぎょ', 'ギョ']
  ]],
  ['b', [
    ['bya', 'bya', 'びゃ', 'ビャ'],
    ['byu', 'byu', 'びゅ', 'ビュ'],
    ['byo', 'byo', 'びょ', 'ビョ']
  ]],
  ['p', [
    ['pya', 'pya', 'ぴゃ', 'ピャ'],
    ['pyu', 'pyu', 'ぴゅ', 'ピュ'],
    ['pyo', 'pyo', 'ぴょ', 'ピョ']
  ]],
  ['z', [
    ['ja', 'ja', 'じゃ', 'ジャ'],
    ['ju', 'ju', 'じゅ', 'ジュ'],
    ['jo', 'jo', 'じょ', 'ジョ']
  ]]
];


function buildRecords(groups, group) {
  return groups.flatMap(([row, items]) =>
    items.flatMap(([id, romaji, hiragana, katakana]) => [
      {
        id: `h-${id}`,
        script: 'hiragana',
        glyph: hiragana,
        romaji,
        row,
        group
      },
      {
        id: `k-${id}`,
        script: 'katakana',
        glyph: katakana,
        romaji,
        row,
        group
      }
    ])
  );
}

export const KANA_DATA = [
  ...buildRecords(BASE_ROWS, 'base'),
  ...buildRecords(DAKUTEN_ROWS, 'dakuten'),
  ...buildRecords(HANDAKUTEN_ROWS, 'handakuten'),
  ...buildRecords(COMBINATION_ROWS, 'combination')
].map((kana) => ({
  ...kana,
  audioId: kana.romaji
}));
