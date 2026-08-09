import { writeFile } from 'node:fs/promises';
import Papa from 'papaparse';

const SUBTLEX_URL =
  'https://raw.githubusercontent.com/words/subtlex-word-frequencies/master/index.json';
const ECDICT_URL =
  'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
const OUTPUT_URL = new URL('../src/data/conversationSeed.ts', import.meta.url);
const TARGET_SIZE = 3000;
const MIN_SOURCE_RANK = 800;

// The previous starter deck and grammatical glue are intentionally omitted.
// This keeps the new deck focused on useful content words instead of repeating
// beginner vocabulary such as “good”, “want”, “today”, and “very”.
const OMIT = new Set(
  `
the be to of and a in that have i it for not on with he as you do at this but his
by from they we say her she or an will my one all would there their what so up
out if about who get which go me when make can like time no just him know take
people into year your good some could them see other than then now look only
come its over think also back after use two how our work first well way even new
want because any these give day most us need mean feel love tell ask call try
help find talk speak listen hear watch show wait leave stay meet bring keep let
start stop week today tomorrow morning night home place thing stuff friend family
food water money job problem bad great nice okay right wrong sure ready busy free
easy hard important different same early late happy sorry really very maybe
probably actually usually always never sometimes already buy pay order eat drink
sleep remember forget understand enjoy is are was were am been being has had does
did done shall should may might must can could would will ought myself yourself
himself herself itself ourselves yourselves themselves mine yours hers ours theirs
here where why while during before after above below under again further once
more much many few each every either neither both another such own same too
don something someone somebody anything anyone anybody nothing nobody everybody
everyone everything little down off still please man life
zero three four five six seven eight nine ten eleven twelve thirteen fourteen
fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty
seventy eighty ninety hundred thousand million billion
`
    .trim()
    .split(/\s+/)
);
const BLOCKED = new Set(
  `fuck fucking fucked fucker motherfucker shit shitty bullshit bitch bastard
asshole ass damn goddamn dick pussy cock crap whore slut nigger nigga fag faggot
cunt porn porno`
    .trim()
    .split(/\s+/)
);

function tidy(value, maxLength = 180) {
  return String(value ?? '')
    .replace(/\\n/g, '；')
    .replace(/\s+/g, ' ')
    .replace(/；+/g, '；')
    .trim()
    .slice(0, maxLength);
}

function firstDefinition(value) {
  const line = String(value ?? '')
    .split(/\\n|\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return tidy(line, 160);
}

function tidyMeaning(value) {
  return String(value ?? '')
    .split(/\\n|\n/)
    .map((item) => tidy(item, 100))
    .filter((item) => item && !item.startsWith('[网络]'))
    .slice(0, 2)
    .join('；')
    .slice(0, 180);
}

const [subtlexResponse, ecdictResponse] = await Promise.all([
  fetch(SUBTLEX_URL),
  fetch(ECDICT_URL),
]);

if (!subtlexResponse.ok || !ecdictResponse.ok) {
  throw new Error(
    `Vocabulary download failed: SUBTLEX ${subtlexResponse.status}, ECDICT ${ecdictResponse.status}`
  );
}

const [subtlex, ecdictCsv] = await Promise.all([
  subtlexResponse.json(),
  ecdictResponse.text(),
]);
const parsed = Papa.parse(ecdictCsv, { header: true, skipEmptyLines: true });
const dictionary = new Map();

for (const row of parsed.data) {
  const word = String(row.word ?? '').toLowerCase();
  if (word && row.translation && !dictionary.has(word))
    dictionary.set(word, row);
}

const selected = [];
const seen = new Set();

for (
  let rank = 0;
  rank < subtlex.length && selected.length < TARGET_SIZE;
  rank += 1
) {
  const rawWord = String(subtlex[rank].word ?? '');
  if (rank + 1 < MIN_SOURCE_RANK) continue;
  let word = rawWord.toLowerCase();
  if (
    rawWord !== word ||
    !/^[a-z][a-z'-]{2,}$/.test(word) ||
    OMIT.has(word) ||
    BLOCKED.has(word) ||
    seen.has(word)
  )
    continue;

  let entry = dictionary.get(word);
  if (!entry) continue;

  const lemma = String(entry.exchange ?? '').match(/(?:^|\/)0:([^/]+)/)?.[1];
  if (lemma && /^[a-z][a-z'-]{2,}$/.test(lemma) && dictionary.has(lemma)) {
    word = lemma;
    entry = dictionary.get(word);
  }
  if (OMIT.has(word) || BLOCKED.has(word) || seen.has(word)) continue;

  const meaning = tidyMeaning(entry.translation);
  if (!meaning || /^\[网络\]/.test(meaning)) continue;

  seen.add(word);
  selected.push([
    word,
    tidy(entry.phonetic, 80),
    meaning,
    firstDefinition(entry.definition),
    rank + 1,
  ]);
}

if (selected.length !== TARGET_SIZE) {
  throw new Error(
    `Expected ${TARGET_SIZE} words, generated ${selected.length}`
  );
}

const rows = selected.map((row) => `  ${JSON.stringify(row)},`).join('\n');
const output = `import type { VocabWord } from './toeflSeed';

// Generated by scripts/generate-spoken-vocabulary.mjs from:
// - SUBTLEX-US spoken-frequency ordering (ISC)
// - ECDICT English-Chinese dictionary fields (MIT)
type SpokenRow = readonly [
  word: string,
  phonetic: string,
  meaning: string,
  definition: string,
  sourceRank: number,
];

const SPOKEN_ROWS: readonly SpokenRow[] = [
${rows}
];

export const conversationVocabulary: VocabWord[] = SPOKEN_ROWS.map(
  ([word, phonetic, meaning, definition, sourceRank], index) => ({
    id: \`spoken-\${index + 1}\`,
    word,
    phonetic: phonetic ? \`/\${phonetic.replace(/^\\/|\\/$/g, '')}/\` : '',
    meaning,
    definition,
    example: '',
    translation: '',
    day: 1,
    sourceRank,
  }),
);
`;

await writeFile(OUTPUT_URL, output, 'utf8');
console.log(`Generated ${selected.length} words at ${OUTPUT_URL.pathname}`);
console.log(
  'First 20:',
  selected
    .slice(0, 20)
    .map(([word]) => word)
    .join(', ')
);
