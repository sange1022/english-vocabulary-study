import { writeFile } from 'node:fs/promises';
import Papa from 'papaparse';
import seekBzip from 'seek-bzip';

const SUBTLEX_URL =
  'https://raw.githubusercontent.com/words/subtlex-word-frequencies/master/index.json';
const ECDICT_URL =
  'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
const TATOEBA_SENTENCES_URL =
  'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2';
const TATOEBA_AUDIO_URL =
  'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_with_audio.tsv.bz2';
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
const OFFENSIVE = new Set([
  ...BLOCKED,
  'cocksucker',
  'hooker',
  'jackass',
  'motherfucking',
  'moron',
  'morons',
  'prostitute',
  'slutty',
  'tits',
]);
const SENSITIVE = new Set([
  ...OFFENSIVE,
  'abortion',
  'alcohol',
  'cancer',
  'cigarette',
  'cocaine',
  'drugs',
  'fascist',
  'heroin',
  'kill',
  'killed',
  'miscarriage',
  'murder',
  'nazi',
  'rape',
  'sex',
  'sexual',
  'smoking',
  'suicide',
]);
const FALLBACK_EXAMPLES = new Map([
  ['abortion', 'The debate about abortion remains deeply personal.'],
  ['alcohol', 'This drink contains no alcohol.'],
  ['cancer', 'Regular checkups can help detect cancer early.'],
  ['cocaine', 'Cocaine is a dangerous and highly addictive drug.'],
  ['heck', 'What the heck are you talking about?'],
  ['heroin', 'Heroin is a dangerous and highly addictive drug.'],
  ['penis', 'The doctor explained the anatomy of the penis.'],
  ['rape', 'The law treats rape as a serious crime.'],
  ['sexual', 'They received clear information about sexual health.'],
  ['tit', 'A blue tit landed on the garden fence.'],
  ['kinda', "I'm kinda tired, so I'm going home early."],
  ['fella', "He's a friendly fella once you get to know him."],
  ['cos', "I stayed home 'cos it was raining."],
  ['gosh', "Gosh, I didn't expect to see you here!"],
  ['thee', 'I give thee my word that I will return.'],
  ['thy', 'Keep thy promise, even when it is difficult.'],
  ['hon', 'Would you like some coffee, hon?'],
  ['mon', 'Take it easy, mon; everything will be fine.'],
  ['dame', 'The actor was appointed a dame for her achievements.'],
  ['blah', 'I felt blah after staying up all night.'],
  ['sire', 'The king hoped to sire an heir.'],
  ['mistress', 'She became the mistress of the old estate.'],
  ['von', 'The name von Trapp is known around the world.'],
  ['tellin', "I'm tellin' you, this is a bad idea."],
  ['takin', "He's takin' the bus home tonight."],
  ['goddess', 'The ancient temple was dedicated to a goddess.'],
  ['til', "Wait here 'til I come back."],
  ['kiddo', 'You did a great job, kiddo!'],
  ['lan', 'Connect the printer to the office LAN.'],
  ['panty', 'She found a panty in the laundry basket.'],
  ['versus', "Tonight's game is Brazil versus Argentina."],
  ['defence', 'The team worked hard on its defence.'],
  ['jolly', 'Everyone was in a jolly mood after dinner.'],
  ['amongst', 'She found the note hidden amongst the books.'],
  ['bam', 'The door slammed shut—bam!'],
  ['feds', 'The feds questioned him about the missing files.'],
  ['intimate', 'They had an intimate conversation over dinner.'],
  ['stud', 'The wall stud supports the shelf.'],
  ['chow', "Let's grab some chow before the movie."],
]);

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

function sentenceTokens(sentence) {
  return sentence.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

function isUsableSentence(sentence) {
  const tokens = sentenceTokens(sentence);
  if (tokens.length < 4 || tokens.length > 18 || sentence.length > 125)
    return false;
  if (
    !/^[\x20-\x7E]+$/.test(sentence) ||
    /https?:|www\.|\d{3,}/i.test(sentence)
  )
    return false;
  return !tokens.some((token) => SENSITIVE.has(token));
}

function sentenceScore(sentence, word, matchedForm) {
  const tokens = sentenceTokens(sentence);
  let score = 100 - Math.abs(tokens.length - 8) * 5;
  if (matchedForm === word) score += 18;
  if (/\b(?:I|you|we|my|your|our)\b/i.test(sentence)) score += 9;
  if (/[?!]$/.test(sentence)) score += 4;
  if (/\b(?:Tom|Mary)\b/.test(sentence)) score -= 14;
  score -= (sentence.match(/\b[A-Z][a-z]+\b/g)?.length ?? 0) * 3;
  if (/['"][^'"]+['"]/.test(sentence)) score -= 6;
  if (/[,;:].*[,;:]/.test(sentence)) score -= 5;
  return score;
}

function exchangeForms(entry, word) {
  const forms = new Set([word]);
  String(entry.exchange ?? '')
    .split('/')
    .forEach((part) => {
      const value = part.includes(':') ? part.slice(part.indexOf(':') + 1) : '';
      value.split(',').forEach((form) => {
        const normalised = form.trim().toLowerCase();
        if (/^[a-z][a-z'-]{2,}$/.test(normalised)) forms.add(normalised);
      });
    });
  return [...forms];
}

function fallbackExample(word, meaning) {
  if (FALLBACK_EXAMPLES.has(word)) return FALLBACK_EXAMPLES.get(word);
  if (OFFENSIVE.has(word))
    return `“${word}” is an offensive term and should be avoided.`;
  if (/^(?:v\.|vt\.|vi\.|vti\.)/i.test(meaning))
    return `I didn't expect them to ${word} so quickly.`;
  if (/^(?:a\.|adj\.)/i.test(meaning))
    return `The situation felt ${word} at first.`;
  if (/^(?:ad\.|adv\.)/i.test(meaning))
    return `We handled the situation ${word}.`;
  return `We talked about the ${word} after dinner.`;
}

const [
  subtlexResponse,
  ecdictResponse,
  tatoebaSentencesResponse,
  tatoebaAudioResponse,
] = await Promise.all([
  fetch(SUBTLEX_URL),
  fetch(ECDICT_URL),
  fetch(TATOEBA_SENTENCES_URL),
  fetch(TATOEBA_AUDIO_URL),
]);

if (
  !subtlexResponse.ok ||
  !ecdictResponse.ok ||
  !tatoebaSentencesResponse.ok ||
  !tatoebaAudioResponse.ok
) {
  throw new Error(
    `Vocabulary download failed: SUBTLEX ${subtlexResponse.status}, ECDICT ${ecdictResponse.status}, Tatoeba sentences ${tatoebaSentencesResponse.status}, Tatoeba audio ${tatoebaAudioResponse.status}`
  );
}

const [subtlex, ecdictCsv, tatoebaSentencesArchive, tatoebaAudioArchive] =
  await Promise.all([
    subtlexResponse.json(),
    ecdictResponse.text(),
    tatoebaSentencesResponse.arrayBuffer(),
    tatoebaAudioResponse.arrayBuffer(),
  ]);
const parsed = Papa.parse(ecdictCsv, { header: true, skipEmptyLines: true });
const dictionary = new Map();

for (const row of parsed.data) {
  const word = String(row.word ?? '').toLowerCase();
  if (word && row.translation && !dictionary.has(word))
    dictionary.set(word, row);
}

const selectedBase = [];
const seen = new Set();

for (
  let rank = 0;
  rank < subtlex.length && selectedBase.length < TARGET_SIZE;
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
  selectedBase.push([
    word,
    tidy(entry.phonetic, 80),
    meaning,
    firstDefinition(entry.definition),
    rank + 1,
  ]);
}

if (selectedBase.length !== TARGET_SIZE) {
  throw new Error(
    `Expected ${TARGET_SIZE} words, generated ${selectedBase.length}`
  );
}

const targetByForm = new Map();
for (const [word] of selectedBase) {
  for (const form of exchangeForms(dictionary.get(word), word)) {
    const targets = targetByForm.get(form) ?? [];
    targets.push(word);
    targetByForm.set(form, targets);
  }
}

const audioTsv = Buffer.from(
  seekBzip.decode(Buffer.from(tatoebaAudioArchive))
).toString('utf8');
const audioIds = new Set(
  audioTsv
    .split('\n')
    .map((line) => line.slice(0, line.indexOf('\t')))
    .filter(Boolean)
);
const sentencesTsv = Buffer.from(
  seekBzip.decode(Buffer.from(tatoebaSentencesArchive))
).toString('utf8');
const bestExamples = new Map();

for (const line of sentencesTsv.split('\n')) {
  const [sentenceId, language, sentence] = line.split('\t');
  if (
    language !== 'eng' ||
    !audioIds.has(sentenceId) ||
    !sentence ||
    !isUsableSentence(sentence)
  )
    continue;

  const uniqueTokens = [...new Set(sentenceTokens(sentence))];
  for (const form of uniqueTokens) {
    for (const word of targetByForm.get(form) ?? []) {
      const score = sentenceScore(sentence, word, form);
      if (score > (bestExamples.get(word)?.score ?? -Infinity))
        bestExamples.set(word, { sentence, score });
    }
  }
}

const selected = selectedBase.map(
  ([word, phonetic, meaning, definition, sourceRank]) => [
    word,
    phonetic,
    meaning,
    definition,
    tidy(
      bestExamples.get(word)?.sentence ?? fallbackExample(word, meaning),
      160
    ),
    sourceRank,
  ]
);

const rows = selected.map((row) => `  ${JSON.stringify(row)},`).join('\n');
const output = `import type { VocabWord } from './toeflSeed';

// Generated by scripts/generate-spoken-vocabulary.mjs from:
// - SUBTLEX-US spoken-frequency ordering (ISC)
// - ECDICT English-Chinese dictionary fields (MIT)
// - Tatoeba English sentences with audio (CC BY 2.0 FR)
type SpokenRow = readonly [
  word: string,
  phonetic: string,
  meaning: string,
  definition: string,
  example: string,
  sourceRank: number,
];

const SPOKEN_ROWS: readonly SpokenRow[] = [
${rows}
];

export const conversationVocabulary: VocabWord[] = SPOKEN_ROWS.map(
  ([word, phonetic, meaning, definition, example, sourceRank], index) => ({
    id: \`spoken-\${index + 1}\`,
    word,
    phonetic: phonetic ? \`/\${phonetic.replace(/^\\/|\\/$/g, '')}/\` : '',
    meaning,
    definition,
    example,
    translation: '',
    day: 1,
    sourceRank,
  }),
);
`;

await writeFile(OUTPUT_URL, output, 'utf8');
console.log(`Generated ${selected.length} words at ${OUTPUT_URL.pathname}`);
console.log(
  `Examples: ${bestExamples.size} Tatoeba matches, ${selected.length - bestExamples.size} reviewed fallbacks`
);
console.log(
  'First 20:',
  selected
    .slice(0, 20)
    .map(([word]) => word)
    .join(', ')
);
