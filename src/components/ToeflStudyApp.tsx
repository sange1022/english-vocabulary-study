import {
  ChangeEvent,
  TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  Download,
  Layers3,
  ListRestart,
  RotateCcw,
  Shuffle,
  Sparkles,
  Settings2,
  Undo2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import Papa from 'papaparse';
import { conversationVocabulary } from '@/data/conversationSeed';
import ogden850Seed from '@/data/ogden850Seed.json';
import toeflBookSeed from '@/data/toeflBookSeed.json';
import { seedVocabulary, type VocabWord } from '@/data/toeflSeed';

type View = 'today' | 'plan' | 'random' | 'mistakes';
type DeckId = 'spoken3000' | 'toeflBook' | 'ogden850' | 'toefl';
type Rating = 'known' | 'fuzzy' | 'unknown';
type RatingMap = Record<string, Rating>;
type ActivityMap = Record<string, string>;
type ImportedDecks = Partial<Record<DeckId, VocabWord[]>>;
type SpeechLanguage = 'en-US' | 'en-GB';

interface SavedPosition {
  deckId: DeckId;
  day: number;
  index: number;
  shuffleMode: boolean;
}

interface SpeechSettings {
  language: SpeechLanguage;
  rate: number;
  autoPlay: boolean;
}

interface LastRatingAction {
  wordId: string;
  previousRating?: Rating;
  previousActivity?: string;
  deckId: DeckId;
  day: number;
  index: number;
  shuffleCycle: number;
}

interface DeckDefinition {
  id: DeckId;
  name: string;
  shortName: string;
  subtitle: string;
  source: string;
  words: VocabWord[];
}

const STORAGE_KEY = 'vocab-study-progress-v1';
const IMPORT_KEY = 'vocab-study-import-v1';
const ACTIVITY_KEY = 'vocab-study-activity-v1';
const POSITION_KEY = 'vocab-study-position-v1';
const SPEECH_KEY = 'vocab-study-speech-v1';
const DEFAULT_POSITION: SavedPosition = {
  deckId: 'spoken3000',
  day: 1,
  index: 0,
  shuffleMode: false,
};
const DEFAULT_SPEECH: SpeechSettings = {
  language: 'en-US',
  rate: 1,
  autoPlay: false,
};
const DEFAULT_DAYS: Record<DeckId, number> = {
  spoken3000: 30,
  toeflBook: 21,
  ogden850: 30,
  toefl: 10,
};
const DECKS: DeckDefinition[] = [
  {
    id: 'spoken3000',
    name: '日常口语进阶 3000',
    shortName: '口语进阶',
    subtitle: '从真实影视对话中积累高频表达',
    source: 'SUBTLEX-US × ECDICT × Tatoeba (CC BY 2.0 FR)',
    words: conversationVocabulary,
  },
  {
    id: 'toeflBook',
    name: '李笑来 TOEFL 核心词汇 2115',
    shortName: 'TOEFL 原书词库',
    subtitle: '学习原书释义、例句、派生词与近义词',
    source: '《TOEFL 核心词汇 21 天突破》扫描版',
    words: toeflBookSeed as VocabWord[],
  },
  {
    id: 'ogden850',
    name: '奥格登基础英语词表',
    shortName: '奥格登基础英语',
    subtitle: '掌握基础英语中的操作词、名词与形容词',
    source: '用户提供的 DOCX · 按文档实际收录 926 条',
    words: ogden850Seed as VocabWord[],
  },
  {
    id: 'toefl',
    name: 'TOEFL 核心示例',
    shortName: 'TOEFL 词汇',
    subtitle: '建立学术英语词汇基础',
    source: '项目内置示例词',
    words: seedVocabulary,
  },
];
const navItems: Array<{ id: View; label: string; icon: typeof BookOpen }> = [
  { id: 'today', label: '今日学习', icon: BookOpen },
  { id: 'plan', label: '学习计划', icon: CalendarDays },
  { id: 'random', label: '抽词清单', icon: Shuffle },
  { id: 'mistakes', label: '错词本', icon: ListRestart },
];

function getVisibleDays(total: number, current: number): Array<number | null> {
  if (total <= 11)
    return Array.from({ length: total }, (_, index) => index + 1);
  const nearby = new Set([1, total]);
  for (let number = current - 3; number <= current + 3; number += 1) {
    if (number > 1 && number < total) nearby.add(number);
  }
  const ordered = [...nearby].sort((a, b) => a - b);
  const result: Array<number | null> = [];
  ordered.forEach((number, index) => {
    if (index > 0 && number - ordered[index - 1] > 1) result.push(null);
    result.push(number);
  });
  return result;
}

function getDayWordRange(totalWords: number, dayCount: number, day: number) {
  const baseSize = Math.floor(totalWords / dayCount);
  const largerDayCount = totalWords % dayCount;
  const zeroBasedDay = day - 1;
  const count = baseSize + (zeroBasedDay < largerDayCount ? 1 : 0);
  const start =
    zeroBasedDay * baseSize + Math.min(zeroBasedDay, largerDayCount);

  return { start, count };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readSavedPosition(): SavedPosition {
  const value = readJson<Partial<SavedPosition>>(POSITION_KEY, {});
  const deckId = DECKS.some((deck) => deck.id === value.deckId)
    ? (value.deckId as DeckId)
    : DEFAULT_POSITION.deckId;
  return {
    deckId,
    day: Math.max(1, Number(value.day) || 1),
    index: Math.max(0, Number(value.index) || 0),
    shuffleMode: Boolean(value.shuffleMode),
  };
}

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normaliseImported(rows: unknown[], deckId: DeckId): VocabWord[] {
  return rows.flatMap((row, index) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    const word = String(item.word ?? item.front ?? '').trim();
    const meaning = String(item.meaning ?? item.back ?? '').trim();
    if (!word || !meaning) return [];
    return [
      {
        id: `import-${deckId}-${Date.now()}-${index}`,
        word,
        phonetic: String(item.phonetic ?? ''),
        meaning,
        example: String(item.example ?? ''),
        translation: String(item.translation ?? ''),
        definition: String(item.definition ?? ''),
        partOfSpeech: String(item.partOfSpeech ?? item.category ?? ''),
        category: String(item.category ?? ''),
        derivatives: String(item.derivatives ?? ''),
        synonyms: String(item.synonyms ?? ''),
        day: 1,
      },
    ];
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffleVocabulary(
  words: VocabWord[],
  context: string,
  cycle: number
): VocabWord[] {
  const createOrder = (cycleNumber: number) => {
    const result = [...words];
    let state = hashString(`${context}:${cycleNumber}`) || 1;
    const random = () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };

    for (let index = result.length - 1; index > 0; index -= 1) {
      const next = Math.floor(random() * (index + 1));
      [result[index], result[next]] = [result[next], result[index]];
    }
    return result;
  };

  const shuffled = createOrder(cycle);

  if (cycle > 0 && shuffled.length > 1) {
    const previous = createOrder(cycle - 1);
    if (shuffled[0]?.id === previous[previous.length - 1]?.id) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }
  }

  return shuffled;
}

export default function ToeflStudyApp() {
  const [initialPosition] = useState<SavedPosition>(readSavedPosition);
  const [view, setView] = useState<View>('today');
  const [deckId, setDeckId] = useState<DeckId>(initialPosition.deckId);
  const [day, setDay] = useState(initialPosition.day);
  const [index, setIndex] = useState(initialPosition.index);
  const [revealed, setRevealed] = useState(false);
  const [shuffleMode, setShuffleMode] = useState(initialPosition.shuffleMode);
  const [shuffleCycle, setShuffleCycle] = useState(0);
  const [roundComplete, setRoundComplete] = useState(false);
  const [ratings, setRatings] = useState<RatingMap>(() =>
    readJson(STORAGE_KEY, {})
  );
  const [activity, setActivity] = useState<ActivityMap>(() =>
    readJson(ACTIVITY_KEY, {})
  );
  const [speechSettings, setSpeechSettings] = useState<SpeechSettings>(() =>
    readJson(SPEECH_KEY, DEFAULT_SPEECH)
  );
  const [lastRatingAction, setLastRatingAction] =
    useState<LastRatingAction | null>(null);
  const [ratingFeedback, setRatingFeedback] = useState<string | null>(null);
  const [importedDecks, setImportedDecks] = useState<ImportedDecks>(() =>
    readJson(IMPORT_KEY, {})
  );
  const [randomSize, setRandomSize] = useState(10);
  const [randomWords, setRandomWords] = useState<VocabWord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const progressFileRef = useRef<HTMLInputElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const selectedDeck = DECKS.find((deck) => deck.id === deckId) ?? DECKS[0];
  const words = useMemo(
    () => [...selectedDeck.words, ...(importedDecks[deckId] ?? [])],
    [deckId, importedDecks, selectedDeck.words]
  );
  const dayCount = Math.min(DEFAULT_DAYS[deckId], Math.max(words.length, 1));
  const dailySize = Math.max(1, Math.ceil(words.length / dayCount));
  const dayWords = useMemo(() => {
    const { start, count } = getDayWordRange(words.length, dayCount, day);
    return words.slice(start, start + count);
  }, [day, dayCount, words]);
  const studyWords = useMemo(
    () =>
      shuffleMode
        ? shuffleVocabulary(
            dayWords,
            `${deckId}:${day}:${dayCount}`,
            shuffleCycle
          )
        : dayWords,
    [day, dayCount, dayWords, deckId, shuffleCycle, shuffleMode]
  );
  const currentWord = studyWords[index % Math.max(studyWords.length, 1)];
  const mistakes = useMemo(
    () =>
      words.filter(
        (word) => ratings[word.id] === 'unknown' || ratings[word.id] === 'fuzzy'
      ),
    [ratings, words]
  );
  const todayKey = getDateKey();
  const completedInGroup = dayWords.filter((word) => ratings[word.id]).length;
  const learnedToday = words.filter(
    (word) => activity[word.id] === todayKey
  ).length;
  const dayRatingStats = dayWords.reduce(
    (stats, word) => {
      const rating = ratings[word.id];
      if (rating) stats[rating] += 1;
      return stats;
    },
    { known: 0, fuzzy: 0, unknown: 0 }
  );
  const visibleDays = useMemo(
    () => getVisibleDays(dayCount, day),
    [dayCount, day]
  );

  useEffect(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings)),
    [ratings]
  );
  useEffect(
    () => localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity)),
    [activity]
  );
  useEffect(
    () => localStorage.setItem(IMPORT_KEY, JSON.stringify(importedDecks)),
    [importedDecks]
  );
  useEffect(
    () => localStorage.setItem(SPEECH_KEY, JSON.stringify(speechSettings)),
    [speechSettings]
  );
  useEffect(() => {
    const position: SavedPosition = { deckId, day, index, shuffleMode };
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  }, [day, deckId, index, shuffleMode]);
  useEffect(() => {
    if (!ratingFeedback) return;
    const timer = window.setTimeout(() => setRatingFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [ratingFeedback]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [deckId, view]);
  useEffect(() => {
    if (!roundComplete) return;
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [roundComplete]);

  const changeDeck = (nextDeckId: DeckId) => {
    setDeckId(nextDeckId);
    setDay(1);
    setIndex(0);
    setShuffleCycle(0);
    setRevealed(false);
    setRoundComplete(false);
    setRandomWords([]);
    setView('today');
  };

  const move = useCallback(
    (direction: number) => {
      if (!studyWords.length || roundComplete) return;
      const next = index + direction;
      if (direction > 0 && next >= studyWords.length) {
        setRoundComplete(true);
      } else {
        setIndex((next + studyWords.length) % studyWords.length);
      }
      setRevealed(false);
    },
    [index, roundComplete, studyWords.length]
  );

  const rate = useCallback(
    (rating: Rating) => {
      if (!currentWord || roundComplete) return;
      setLastRatingAction({
        wordId: currentWord.id,
        previousRating: ratings[currentWord.id],
        previousActivity: activity[currentWord.id],
        deckId,
        day,
        index,
        shuffleCycle,
      });
      setRatings((previous) => ({ ...previous, [currentWord.id]: rating }));
      setActivity((previous) => ({
        ...previous,
        [currentWord.id]: getDateKey(),
      }));
      const label =
        rating === 'known' ? '认识' : rating === 'fuzzy' ? '模糊' : '不认识';
      setRatingFeedback(`已标记为“${label}”`);
      move(1);
    },
    [
      activity,
      currentWord,
      day,
      deckId,
      index,
      move,
      ratings,
      roundComplete,
      shuffleCycle,
    ]
  );

  const undoLastRating = () => {
    if (!lastRatingAction) return;
    const action = lastRatingAction;
    setRatings((previous) => {
      const next = { ...previous };
      if (action.previousRating) next[action.wordId] = action.previousRating;
      else delete next[action.wordId];
      return next;
    });
    setActivity((previous) => {
      const next = { ...previous };
      if (action.previousActivity)
        next[action.wordId] = action.previousActivity;
      else delete next[action.wordId];
      return next;
    });
    setDeckId(action.deckId);
    setDay(action.day);
    setIndex(action.index);
    setShuffleCycle(action.shuffleCycle);
    setRoundComplete(false);
    setRevealed(false);
    setLastRatingAction(null);
    setRatingFeedback('已撤销上一次评价');
  };

  const continueUnfinished = () => {
    const nextIndex = studyWords.findIndex((word) => !ratings[word.id]);
    if (nextIndex < 0) {
      setRoundComplete(true);
      return;
    }
    setIndex(nextIndex);
    setRoundComplete(false);
    setRevealed(false);
    setView('today');
  };

  const restartRound = () => {
    if (shuffleMode) setShuffleCycle((previous) => previous + 1);
    setIndex(0);
    setRoundComplete(false);
    setRevealed(false);
  };

  const markMistakeLearned = (id: string) => {
    setRatings((previous) => ({ ...previous, [id]: 'known' }));
    setActivity((previous) => ({ ...previous, [id]: getDateKey() }));
    setRatingFeedback('已标记掌握并移出错词本');
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (event.code === 'Space') {
        event.preventDefault();
        setRevealed((value) => !value);
      }
      if (event.key === '1') rate('known');
      if (event.key === '2') rate('fuzzy');
      if (event.key === '3') rate('unknown');
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [move, rate]);

  useEffect(() => {
    if (day > dayCount) setDay(dayCount);
    if (index >= studyWords.length && studyWords.length) setIndex(0);
  }, [day, dayCount, index, studyWords.length]);

  const speakWord = useCallback(
    (word: VocabWord) => {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word.word);
      utterance.lang = speechSettings.language;
      utterance.rate = speechSettings.rate;
      speechSynthesis.speak(utterance);
    },
    [speechSettings.language, speechSettings.rate]
  );

  const speak = () => {
    if (currentWord) speakWord(currentWord);
  };

  useEffect(() => {
    if (!speechSettings.autoPlay || !currentWord || roundComplete) return;
    speakWord(currentWord);
  }, [currentWord, roundComplete, speakWord, speechSettings.autoPlay]);

  const startTouch = (event: ReactTouchEvent<HTMLElement>) => {
    const touch = event.changedTouches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const finishTouch = (event: ReactTouchEvent<HTMLElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || roundComplete) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 65) return;
    if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY < 0) rate('fuzzy');
    else if (Math.abs(deltaX) > Math.abs(deltaY))
      rate(deltaX > 0 ? 'known' : 'unknown');
  };

  const exportProgress = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      ratings,
      activity,
      importedDecks,
      position: { deckId, day, index, shuffleMode },
      speechSettings,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `词刻学习进度-${getDateKey()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProgress = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text()) as {
        ratings?: RatingMap;
        activity?: ActivityMap;
        importedDecks?: ImportedDecks;
        position?: SavedPosition;
        speechSettings?: SpeechSettings;
      };
      if (backup.ratings) setRatings(backup.ratings);
      if (backup.activity) setActivity(backup.activity);
      if (backup.importedDecks) setImportedDecks(backup.importedDecks);
      if (backup.speechSettings) setSpeechSettings(backup.speechSettings);
      if (
        backup.position &&
        DECKS.some((deck) => deck.id === backup.position?.deckId)
      ) {
        setDeckId(backup.position.deckId);
        setDay(backup.position.day);
        setIndex(backup.position.index);
        setShuffleMode(backup.position.shuffleMode);
      }
      setRatingFeedback('学习进度已导入');
      setView('today');
    } catch {
      setRatingFeedback('进度文件无法识别');
    }
    event.target.value = '';
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    let rows: unknown[] = [];
    if (file.name.toLowerCase().endsWith('.json')) {
      const parsed = JSON.parse(content) as unknown;
      rows = Array.isArray(parsed) ? parsed : [];
    } else {
      rows = Papa.parse<Record<string, unknown>>(content, {
        header: true,
        skipEmptyLines: true,
      }).data;
    }
    const normalised = normaliseImported(rows, deckId);
    if (normalised.length) {
      setImportedDecks((previous) => ({
        ...previous,
        [deckId]: [...(previous[deckId] ?? []), ...normalised],
      }));
      setView('plan');
    }
    event.target.value = '';
  };

  const generateRandomGroup = () => {
    const pool = [...words];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setRandomWords(pool.slice(0, Math.min(randomSize, pool.length)));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView('today')}>
          词刻
        </button>
        <DeckSettings
          className="sidebar-deck-settings"
          deckId={deckId}
          dayCount={dayCount}
          dailySize={dailySize}
          totalWords={words.length}
          onDeckChange={changeDeck}
        />
        <nav aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setView(item.id)}
              >
                <Icon size={21} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === 'mistakes' && mistakes.length > 0 ? (
                  <b>{mistakes.length}</b>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-tools">
          <button
            className="import-button"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={20} strokeWidth={1.8} />
            导入词表
          </button>
          <button onClick={exportProgress}>
            <Download size={19} strokeWidth={1.8} />
            导出进度
          </button>
          <button onClick={() => progressFileRef.current?.click()}>
            <Upload size={19} strokeWidth={1.8} />
            导入进度
          </button>
        </div>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept=".csv,.json"
          onChange={importFile}
        />
        <input
          ref={progressFileRef}
          className="visually-hidden"
          type="file"
          accept=".json"
          onChange={importProgress}
        />
        <p className="sidebar-author-credit">
          作者 · <strong>戌無营造</strong>
        </p>
      </aside>

      <main className="main-area">
        <DeckSettings
          className="mobile-deck-settings"
          deckId={deckId}
          dayCount={dayCount}
          dailySize={dailySize}
          totalWords={words.length}
          onDeckChange={changeDeck}
        />
        {view === 'today' ? (
          <>
            <header className="study-header">
              <div>
                <h1>
                  第 {String(day).padStart(2, '0')} 天 · {selectedDeck.subtitle}
                </h1>
                <p className="deck-source">
                  {selectedDeck.name} · {selectedDeck.source}
                </p>
                <div className="day-strip" aria-label="学习计划">
                  {visibleDays.map((number, position) =>
                    number === null ? (
                      <span className="day-ellipsis" key={`gap-${position}`}>
                        ···
                      </span>
                    ) : (
                      <button
                        key={number}
                        className={
                          day === number ? 'day-dot active' : 'day-dot'
                        }
                        onClick={() => {
                          setDay(number);
                          setIndex(0);
                          setRevealed(false);
                          setRoundComplete(false);
                        }}
                      >
                        {number}
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className="headline-progress">
                <span>
                  <strong>
                    {studyWords.length ? (index % studyWords.length) + 1 : 0}
                  </strong>{' '}
                  / {studyWords.length}
                </span>
                <div>
                  <i
                    style={{
                      width: `${studyWords.length ? (((index % studyWords.length) + 1) / studyWords.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </header>

            <div className="workspace">
              <section className="study-stage">
                <div className="mode-switch" aria-label="学习模式">
                  <button
                    className={!shuffleMode ? 'active' : ''}
                    onClick={() => {
                      setShuffleMode(false);
                      setIndex(0);
                      setRevealed(false);
                      setRoundComplete(false);
                    }}
                  >
                    <ListRestart size={19} />
                    顺序学习
                  </button>
                  <button
                    className={shuffleMode ? 'active' : ''}
                    aria-label="随机学习，本轮不重复"
                    onClick={() => {
                      if (!shuffleMode) {
                        setShuffleCycle((previous) => previous + 1);
                        setIndex(0);
                        setRevealed(false);
                        setRoundComplete(false);
                      }
                      setShuffleMode(true);
                    }}
                  >
                    <Shuffle size={19} />
                    随机学习
                  </button>
                </div>
                {shuffleMode ? (
                  <p className="shuffle-note">
                    本轮不重复 · 学完后显示学习总结
                  </p>
                ) : null}
                <details className="speech-settings">
                  <summary>
                    <Settings2 size={16} />
                    发音设置
                  </summary>
                  <div>
                    <label>
                      口音
                      <select
                        aria-label="发音口音"
                        value={speechSettings.language}
                        onChange={(event) =>
                          setSpeechSettings((current) => ({
                            ...current,
                            language: event.target.value as SpeechLanguage,
                          }))
                        }
                      >
                        <option value="en-US">美音</option>
                        <option value="en-GB">英音</option>
                      </select>
                    </label>
                    <label>
                      语速
                      <select
                        aria-label="发音语速"
                        value={speechSettings.rate}
                        onChange={(event) =>
                          setSpeechSettings((current) => ({
                            ...current,
                            rate: Number(event.target.value),
                          }))
                        }
                      >
                        <option value="0.8">较慢</option>
                        <option value="1">正常</option>
                        <option value="1.2">较快</option>
                      </select>
                    </label>
                    <label className="auto-speak-toggle">
                      <input
                        type="checkbox"
                        checked={speechSettings.autoPlay}
                        onChange={(event) =>
                          setSpeechSettings((current) => ({
                            ...current,
                            autoPlay: event.target.checked,
                          }))
                        }
                      />
                      切换单词时自动朗读
                    </label>
                  </div>
                </details>
                {roundComplete ? (
                  <RoundSummary
                    total={dayWords.length}
                    known={dayRatingStats.known}
                    fuzzy={dayRatingStats.fuzzy}
                    unknown={dayRatingStats.unknown}
                    onRestart={restartRound}
                    onReview={() => setView('mistakes')}
                  />
                ) : currentWord ? (
                  <article
                    className={revealed ? 'flashcard revealed' : 'flashcard'}
                    onTouchStart={startTouch}
                    onTouchEnd={finishTouch}
                  >
                    <button
                      className="speaker"
                      onClick={speak}
                      aria-label="朗读单词"
                    >
                      <Volume2 size={21} />
                    </button>
                    <button
                      className="card-word"
                      onClick={() => setRevealed((value) => !value)}
                    >
                      <span className="card-word-line">
                        {currentWord.partOfSpeech ? (
                          <b className="word-type-badge">
                            {currentWord.partOfSpeech}
                          </b>
                        ) : null}
                        {currentWord.word}
                      </span>
                      <small>
                        {currentWord.phonetic ||
                          (revealed ? '点击卡片隐藏释义' : '点击卡片查看释义')}
                      </small>
                    </button>
                    <div className="card-answer" aria-hidden={!revealed}>
                      <h2>{currentWord.meaning}</h2>
                      {currentWord.sourceUnit ? (
                        <BookWordDetails word={currentWord} />
                      ) : null}
                      {deckId !== 'spoken3000' && currentWord.definition ? (
                        <p className="english-definition">
                          <span>EN</span>
                          {currentWord.definition}
                        </p>
                      ) : null}
                      {!currentWord.sourceUnit && currentWord.example ? (
                        <p className="example-sentence">
                          <span>例句</span>
                          {currentWord.example}
                        </p>
                      ) : null}
                      {!currentWord.sourceUnit && currentWord.translation ? (
                        <p className="translation">{currentWord.translation}</p>
                      ) : null}
                    </div>
                    <button
                      className="reveal-button"
                      onClick={() => setRevealed((value) => !value)}
                    >
                      <BookOpen size={19} />
                      {revealed ? '隐藏释义' : '显示释义'}
                    </button>
                  </article>
                ) : (
                  <article className="empty-state">
                    <Sparkles size={28} />
                    <h2>这一天还没有词汇</h2>
                    <p>请减少计划天数，或导入更多词汇。</p>
                  </article>
                )}

                {!roundComplete ? (
                  <div className="rating-row">
                    <button
                      className={
                        ratings[currentWord?.id ?? ''] === 'known'
                          ? 'known selected'
                          : 'known'
                      }
                      aria-pressed={ratings[currentWord?.id ?? ''] === 'known'}
                      onClick={() => rate('known')}
                    >
                      <Check />
                      <span>
                        认识<small>1</small>
                      </span>
                    </button>
                    <button
                      className={
                        ratings[currentWord?.id ?? ''] === 'fuzzy'
                          ? 'fuzzy selected'
                          : 'fuzzy'
                      }
                      aria-pressed={ratings[currentWord?.id ?? ''] === 'fuzzy'}
                      onClick={() => rate('fuzzy')}
                    >
                      <CircleMinus />
                      <span>
                        模糊<small>2</small>
                      </span>
                    </button>
                    <button
                      className={
                        ratings[currentWord?.id ?? ''] === 'unknown'
                          ? 'unknown selected'
                          : 'unknown'
                      }
                      aria-pressed={
                        ratings[currentWord?.id ?? ''] === 'unknown'
                      }
                      onClick={() => rate('unknown')}
                    >
                      <X />
                      <span>
                        不认识<small>3</small>
                      </span>
                    </button>
                  </div>
                ) : null}
                {!roundComplete ? (
                  <div className="card-navigation">
                    <button onClick={() => move(-1)} aria-label="上一个单词">
                      <ChevronLeft />
                    </button>
                    <span>空格翻面 · 1/2/3 选择 · 手机可左右/上滑</span>
                    <button onClick={() => move(1)} aria-label="下一个单词">
                      <ChevronRight />
                    </button>
                  </div>
                ) : null}
              </section>

              <aside className="progress-rail">
                <h2>今日进度</h2>
                <div className="stat">
                  <BookOpen />
                  <span>
                    今日学习<strong>{learnedToday}</strong>
                  </span>
                </div>
                <div className="stat blue">
                  <RotateCcw />
                  <span>
                    复习<strong>{mistakes.length}</strong>
                  </span>
                </div>
                <div className="stat amber">
                  <Layers3 />
                  <span>
                    计划
                    <strong>
                      {dayCount}
                      <small>天</small>
                    </strong>
                  </span>
                </div>
                <button className="review-button" onClick={continueUnfinished}>
                  <BookOpen size={18} />
                  继续未完成
                </button>
                <p>
                  本组累计 {completedInGroup} / {dayWords.length}
                </p>
              </aside>
            </div>
          </>
        ) : null}

        {view === 'plan' ? (
          <PlanView
            words={words}
            ratings={ratings}
            day={day}
            dayCount={dayCount}
            deckName={selectedDeck.name}
            onSelectDay={(selected) => {
              setDay(selected);
              setIndex(0);
              setRoundComplete(false);
              setRevealed(false);
              setView('today');
            }}
          />
        ) : null}
        {view === 'random' ? (
          <RandomView
            words={randomWords}
            size={randomSize}
            onSize={setRandomSize}
            onGenerate={generateRandomGroup}
          />
        ) : null}
        {view === 'mistakes' ? (
          <MistakesView
            words={mistakes}
            ratings={ratings}
            onClear={markMistakeLearned}
          />
        ) : null}
        <div className="mobile-progress-tools">
          <button onClick={exportProgress}>
            <Download size={17} />
            导出学习进度
          </button>
          <button onClick={() => progressFileRef.current?.click()}>
            <Upload size={17} />
            导入学习进度
          </button>
        </div>
        <footer className="mobile-author-credit">
          作者 · <strong>戌無营造</strong>
        </footer>
      </main>

      <nav className="mobile-nav" aria-label="移动端导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      {ratingFeedback ? (
        <div className="rating-feedback" role="status">
          <span>{ratingFeedback}</span>
          {lastRatingAction ? (
            <button onClick={undoLastRating}>
              <Undo2 size={16} />
              撤销
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RoundSummary({
  total,
  known,
  fuzzy,
  unknown,
  onRestart,
  onReview,
}: {
  total: number;
  known: number;
  fuzzy: number;
  unknown: number;
  onRestart: () => void;
  onReview: () => void;
}) {
  const rated = known + fuzzy + unknown;

  return (
    <article className="round-summary">
      <div className="round-summary-mark">
        <Check />
      </div>
      <h2>本轮浏览完成</h2>
      <p>
        已评价 {rated} / {total} 个单词
      </p>
      <div className="round-summary-stats">
        <span>
          认识<strong>{known}</strong>
        </span>
        <span>
          模糊<strong>{fuzzy}</strong>
        </span>
        <span>
          不认识<strong>{unknown}</strong>
        </span>
      </div>
      <div className="round-summary-actions">
        <button onClick={onReview} disabled={fuzzy + unknown === 0}>
          <RotateCcw size={18} />
          复习模糊和生词
        </button>
        <button onClick={onRestart}>
          <Shuffle size={18} />
          重新学习全部
        </button>
      </div>
    </article>
  );
}

function BookWordDetails({ word }: { word: VocabWord }) {
  const sourceLabel = word.sourcePage
    ? `Unit ${word.sourceUnit} · PDF 第 ${word.sourcePage} 页`
    : `Unit ${word.sourceUnit}`;

  return (
    <div className="book-word-details">
      <p className="book-source-line">{sourceLabel}</p>
      {word.example ? (
        <section>
          <span>例句</span>
          <p>{word.example}</p>
        </section>
      ) : null}
      {word.derivatives ? (
        <section>
          <span>派生词</span>
          <p>{word.derivatives}</p>
        </section>
      ) : null}
      {word.synonyms ? (
        <section>
          <span>近义词</span>
          <p>{word.synonyms}</p>
        </section>
      ) : null}
      {word.sourceDetailStatus === 'source-page-missing' ? (
        <p className="source-warning">
          原 PDF 对应详情页缺失；当前仅显示词表与开源词典基础释义。
        </p>
      ) : null}
      {word.sourceDetailStatus === 'partial-source' ? (
        <p className="source-warning">
          原 PDF 中该词条内容不完整；已保留能够确认的部分。
        </p>
      ) : null}
    </div>
  );
}

function DeckSettings({
  className,
  deckId,
  dayCount,
  dailySize,
  totalWords,
  onDeckChange,
}: {
  className: string;
  deckId: DeckId;
  dayCount: number;
  dailySize: number;
  totalWords: number;
  onDeckChange: (deckId: DeckId) => void;
}) {
  return (
    <section className={`deck-settings ${className}`} aria-label="词库设置">
      <label>
        <span>当前词库</span>
        <select
          value={deckId}
          onChange={(event) => onDeckChange(event.target.value as DeckId)}
        >
          {DECKS.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.name}
            </option>
          ))}
        </select>
      </label>
      <div className="fixed-plan">
        <span>固定计划</span>
        <strong>{dayCount} 天</strong>
      </div>
      <p>
        共 {totalWords} 词 · 每天约 {dailySize} 词
      </p>
    </section>
  );
}

function PlanView({
  words,
  ratings,
  day,
  dayCount,
  deckName,
  onSelectDay,
}: {
  words: VocabWord[];
  ratings: RatingMap;
  day: number;
  dayCount: number;
  deckName: string;
  onSelectDay: (day: number) => void;
}) {
  return (
    <section className="secondary-view">
      <div className="view-heading">
        <div>
          <h1>{deckName} · 学习计划</h1>
          <p>
            共 {words.length} 个词，固定分成 {dayCount}{' '}
            天；每天的词量已自动均匀分配。
          </p>
        </div>
        <CalendarDays />
      </div>
      <div className="plan-grid">
        {Array.from({ length: dayCount }, (_, i) => i + 1).map((number) => {
          const { start, count } = getDayWordRange(
            words.length,
            dayCount,
            number
          );
          const completed = words
            .slice(start, start + count)
            .filter((word) => ratings[word.id]).length;
          const progress = count ? (completed / count) * 100 : 0;
          const status =
            completed === count
              ? '已完成'
              : completed > 0
                ? '学习中'
                : '未开始';
          return (
            <button
              key={number}
              className={day === number ? 'plan-day current' : 'plan-day'}
              onClick={() => onSelectDay(number)}
            >
              <span>DAY {String(number).padStart(2, '0')}</span>
              <strong>
                {completed}
                <em> / {count}</em>
              </strong>
              <small>{status}</small>
              <i style={{ width: `${progress}%` }} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RandomView({
  words,
  size,
  onSize,
  onGenerate,
}: {
  words: VocabWord[];
  size: number;
  onSize: (size: number) => void;
  onGenerate: () => void;
}) {
  return (
    <section className="secondary-view">
      <div className="view-heading">
        <div>
          <h1>抽词清单</h1>
          <p>从全部词汇中随机抽取一份清单，适合集中预习或抄写。</p>
        </div>
        <Shuffle />
      </div>
      <div className="random-toolbar">
        <label>
          每组词数
          <select
            value={size}
            onChange={(event) => onSize(Number(event.target.value))}
          >
            <option>10</option>
            <option>20</option>
            <option>40</option>
          </select>
        </label>
        <button onClick={onGenerate}>
          <Shuffle size={18} />
          生成新清单
        </button>
      </div>
      {words.length ? (
        <div className="word-list">
          {words.map((word, index) => (
            <div key={word.id}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>
                {word.partOfSpeech ? (
                  <em className="word-list-type">{word.partOfSpeech}</em>
                ) : null}
                {word.word}
              </strong>
              <p>{word.meaning}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="large-empty">
          <Shuffle />
          <h2>还没有抽词清单</h2>
          <p>选择数量并生成一份随机词汇清单。</p>
        </div>
      )}
    </section>
  );
}

function MistakesView({
  words,
  ratings,
  onClear,
}: {
  words: VocabWord[];
  ratings: RatingMap;
  onClear: (id: string) => void;
}) {
  const [checkQueue, setCheckQueue] = useState<VocabWord[]>([]);
  const [checkTotal, setCheckTotal] = useState(0);
  const [checkedCount, setCheckedCount] = useState(0);
  const [checkRevealed, setCheckRevealed] = useState(false);
  const [checkStarted, setCheckStarted] = useState(false);
  const currentCheckWord = checkQueue[0];

  const startCheck = () => {
    const queue = shuffleVocabulary(words, 'mistake-check', Date.now());
    setCheckQueue(queue);
    setCheckTotal(queue.length);
    setCheckedCount(0);
    setCheckRevealed(false);
    setCheckStarted(true);
  };

  const finishCurrentCheck = (learned: boolean) => {
    if (!currentCheckWord) return;
    if (learned) onClear(currentCheckWord.id);
    setCheckQueue((current) => current.slice(1));
    setCheckedCount((current) => current + 1);
    setCheckRevealed(false);
  };

  if (checkStarted) {
    return (
      <section className="secondary-view">
        <div className="view-heading mistake-check-heading">
          <div>
            <h1>错词随机检查</h1>
            <p>本轮随机且不重复，先回想答案，再判断自己是否掌握。</p>
          </div>
          <button
            className="text-action-button"
            onClick={() => setCheckStarted(false)}
          >
            返回错词本
          </button>
        </div>
        {currentCheckWord ? (
          <div className="mistake-check-stage">
            <div className="mistake-check-progress">
              <span>本轮进度</span>
              <strong>
                {checkedCount + 1} / {checkTotal}
              </strong>
            </div>
            <article
              className={
                checkRevealed
                  ? 'mistake-check-card revealed'
                  : 'mistake-check-card'
              }
            >
              <span className={ratings[currentCheckWord.id]}>
                {ratings[currentCheckWord.id] === 'fuzzy' ? '模糊' : '生词'}
              </span>
              <h2>
                {currentCheckWord.partOfSpeech ? (
                  <small className="mistake-word-type">
                    {currentCheckWord.partOfSpeech}
                  </small>
                ) : null}
                {currentCheckWord.word}
              </h2>
              {currentCheckWord.phonetic ? (
                <small>{currentCheckWord.phonetic}</small>
              ) : null}
              {checkRevealed ? (
                <div className="mistake-check-answer">
                  <p>{currentCheckWord.meaning}</p>
                  {currentCheckWord.example ? (
                    <blockquote>{currentCheckWord.example}</blockquote>
                  ) : null}
                </div>
              ) : (
                <button
                  className="reveal-check-button"
                  onClick={() => setCheckRevealed(true)}
                >
                  <BookOpen size={18} />
                  显示答案
                </button>
              )}
            </article>
            {checkRevealed ? (
              <div className="mistake-check-actions">
                <button
                  className="keep-learning"
                  onClick={() => finishCurrentCheck(false)}
                >
                  <RotateCcw size={19} />
                  还不会，继续保留
                </button>
                <button
                  className="learned"
                  onClick={() => finishCurrentCheck(true)}
                >
                  <Check size={19} />
                  已经会了
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="large-empty mistake-check-complete">
            <Check />
            <h2>本轮检查完成</h2>
            <p>标记“已经会了”的单词已从错词本移除。</p>
            {words.length ? (
              <div>
                <button onClick={startCheck}>
                  <Shuffle size={18} />
                  再随机检查一轮
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="secondary-view">
      <div className="view-heading">
        <div>
          <h1>错词本</h1>
          <p>“模糊”和“不认识”的词会自动汇集到这里。</p>
        </div>
        {words.length ? (
          <button className="primary-heading-button" onClick={startCheck}>
            <Shuffle size={18} />
            随机检查
          </button>
        ) : (
          <ListRestart />
        )}
      </div>
      {words.length ? (
        <div className="word-list">
          {words.map((word) => (
            <div key={word.id}>
              <span className={ratings[word.id]}>
                {ratings[word.id] === 'fuzzy' ? '模糊' : '生词'}
              </span>
              <strong>
                {word.partOfSpeech ? (
                  <em className="word-list-type">{word.partOfSpeech}</em>
                ) : null}
                {word.word}
              </strong>
              <p>{word.meaning}</p>
              <button onClick={() => onClear(word.id)}>
                <Check size={16} />
                标记掌握
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="large-empty">
          <Check />
          <h2>错词本是空的</h2>
          <p>继续学习，系统会自动整理需要复习的词。</p>
        </div>
      )}
    </section>
  );
}
