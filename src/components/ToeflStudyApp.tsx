import {
  ChangeEvent,
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
  Layers3,
  ListRestart,
  RotateCcw,
  Shuffle,
  Sparkles,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import Papa from 'papaparse';
import { conversationVocabulary } from '@/data/conversationSeed';
import toeflBookSeed from '@/data/toeflBookSeed.json';
import { seedVocabulary, type VocabWord } from '@/data/toeflSeed';

type View = 'today' | 'plan' | 'random' | 'mistakes';
type DeckId = 'spoken3000' | 'toeflBook' | 'toefl';
type Rating = 'known' | 'fuzzy' | 'unknown';
type RatingMap = Record<string, Rating>;
type ImportedDecks = Partial<Record<DeckId, VocabWord[]>>;

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
const SETTINGS_KEY = 'vocab-study-settings-v2';
const DEFAULT_DAYS: Record<DeckId, number> = {
  spoken3000: 100,
  toeflBook: 100,
  toefl: 10,
};
const DECKS: DeckDefinition[] = [
  {
    id: 'spoken3000',
    name: '日常口语进阶 3000',
    shortName: '口语进阶',
    subtitle: '从真实影视对话中积累高频表达',
    source: 'SUBTLEX-US × ECDICT',
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
  { id: 'random', label: '随机分组', icon: Shuffle },
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

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
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
        derivatives: String(item.derivatives ?? ''),
        synonyms: String(item.synonyms ?? ''),
        day: 1,
      },
    ];
  });
}

export default function ToeflStudyApp() {
  const [view, setView] = useState<View>('today');
  const [deckId, setDeckId] = useState<DeckId>('spoken3000');
  const [day, setDay] = useState(1);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(true);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [ratings, setRatings] = useState<RatingMap>(() =>
    readJson(STORAGE_KEY, {})
  );
  const [importedDecks, setImportedDecks] = useState<ImportedDecks>(() =>
    readJson(IMPORT_KEY, {})
  );
  const [daysByDeck, setDaysByDeck] = useState<Record<DeckId, number>>(() =>
    readJson(SETTINGS_KEY, DEFAULT_DAYS)
  );
  const [randomSize, setRandomSize] = useState(10);
  const [randomWords, setRandomWords] = useState<VocabWord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedDeck = DECKS.find((deck) => deck.id === deckId) ?? DECKS[0];
  const words = useMemo(
    () => [...selectedDeck.words, ...(importedDecks[deckId] ?? [])],
    [deckId, importedDecks, selectedDeck.words]
  );
  const dayCount = Math.min(
    Math.max(1, daysByDeck[deckId] ?? DEFAULT_DAYS[deckId]),
    Math.max(words.length, 1)
  );
  const dailySize = Math.max(1, Math.ceil(words.length / dayCount));
  const dayWords = useMemo(() => {
    const start = (day - 1) * dailySize;
    return words.slice(start, Math.min(start + dailySize, words.length));
  }, [dailySize, day, words]);
  const currentWord = dayWords[index % Math.max(dayWords.length, 1)];
  const mistakes = useMemo(
    () =>
      words.filter(
        (word) => ratings[word.id] === 'unknown' || ratings[word.id] === 'fuzzy'
      ),
    [ratings, words]
  );
  const completedToday = dayWords.filter((word) => ratings[word.id]).length;
  const visibleDays = useMemo(
    () => getVisibleDays(dayCount, day),
    [dayCount, day]
  );

  useEffect(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings)),
    [ratings]
  );
  useEffect(
    () => localStorage.setItem(IMPORT_KEY, JSON.stringify(importedDecks)),
    [importedDecks]
  );
  useEffect(
    () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(daysByDeck)),
    [daysByDeck]
  );

  const changeDeck = (nextDeckId: DeckId) => {
    setDeckId(nextDeckId);
    setDay(1);
    setIndex(0);
    setRevealed(true);
    setRandomWords([]);
    setView('today');
  };

  const changeDayCount = (value: number) => {
    const next = Math.min(
      Math.max(1, Math.round(value) || 1),
      Math.max(words.length, 1)
    );
    setDaysByDeck((previous) => ({ ...previous, [deckId]: next }));
    setDay(1);
    setIndex(0);
    setRevealed(true);
  };

  const goTo = useCallback(
    (next: number) => {
      if (!dayWords.length) return;
      setIndex((next + dayWords.length) % dayWords.length);
      setRevealed(false);
    },
    [dayWords.length]
  );

  const rate = useCallback(
    (rating: Rating) => {
      if (!currentWord) return;
      setRatings((previous) => ({ ...previous, [currentWord.id]: rating }));
      const next = shuffleMode
        ? Math.floor(Math.random() * dayWords.length)
        : (index + 1) % dayWords.length;
      goTo(next);
    },
    [currentWord, dayWords.length, goTo, index, shuffleMode]
  );

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
      if (event.key === 'ArrowLeft') goTo(index - 1);
      if (event.key === 'ArrowRight') goTo(index + 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goTo, index, rate]);

  const speak = () => {
    if (!currentWord || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(currentWord.word);
    utterance.lang = 'en-US';
    speechSynthesis.speak(utterance);
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
          onDayCountChange={changeDayCount}
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
        <button
          className="import-button"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={20} strokeWidth={1.8} />
          导入词表
        </button>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept=".csv,.json"
          onChange={importFile}
        />
      </aside>

      <main className="main-area">
        <DeckSettings
          className="mobile-deck-settings"
          deckId={deckId}
          dayCount={dayCount}
          dailySize={dailySize}
          totalWords={words.length}
          onDeckChange={changeDeck}
          onDayCountChange={changeDayCount}
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
                    {dayWords.length ? (index % dayWords.length) + 1 : 0}
                  </strong>{' '}
                  / {dayWords.length}
                </span>
                <div>
                  <i
                    style={{
                      width: `${dayWords.length ? (((index % dayWords.length) + 1) / dayWords.length) * 100 : 0}%`,
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
                    onClick={() => setShuffleMode(false)}
                  >
                    <ListRestart size={19} />
                    顺序学习
                  </button>
                  <button
                    className={shuffleMode ? 'active' : ''}
                    onClick={() => setShuffleMode(true)}
                  >
                    <Shuffle size={19} />
                    随机学习
                  </button>
                </div>
                {currentWord ? (
                  <article
                    className={revealed ? 'flashcard revealed' : 'flashcard'}
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
                      <span>{currentWord.word}</span>
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
                      {currentWord.definition ? (
                        <p className="english-definition">
                          <span>EN</span>
                          {currentWord.definition}
                        </p>
                      ) : null}
                      {!currentWord.sourceUnit && currentWord.example ? (
                        <p>{currentWord.example}</p>
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

                <div className="rating-row">
                  <button className="known" onClick={() => rate('known')}>
                    <Check />
                    <span>
                      认识<small>1</small>
                    </span>
                  </button>
                  <button className="fuzzy" onClick={() => rate('fuzzy')}>
                    <CircleMinus />
                    <span>
                      模糊<small>2</small>
                    </span>
                  </button>
                  <button className="unknown" onClick={() => rate('unknown')}>
                    <X />
                    <span>
                      不认识<small>3</small>
                    </span>
                  </button>
                </div>
                <div className="card-navigation">
                  <button
                    onClick={() => goTo(index - 1)}
                    aria-label="上一个单词"
                  >
                    <ChevronLeft />
                  </button>
                  <span>空格翻面 · 1/2/3 选择</span>
                  <button
                    onClick={() => goTo(index + 1)}
                    aria-label="下一个单词"
                  >
                    <ChevronRight />
                  </button>
                </div>
              </section>

              <aside className="progress-rail">
                <h2>今日进度</h2>
                <div className="stat">
                  <BookOpen />
                  <span>
                    今日<strong>{dayWords.length}</strong>
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
                <button
                  className="review-button"
                  onClick={() => setView('mistakes')}
                >
                  <RotateCcw size={18} />
                  开始复习
                </button>
                <p>
                  已完成 {completedToday} / {dayWords.length}
                </p>
              </aside>
            </div>
          </>
        ) : null}

        {view === 'plan' ? (
          <PlanView
            words={words}
            day={day}
            dayCount={dayCount}
            dailySize={dailySize}
            deckName={selectedDeck.name}
            onSelectDay={(selected) => {
              setDay(selected);
              setIndex(0);
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
            onClear={(id) =>
              setRatings((previous) => ({ ...previous, [id]: 'known' }))
            }
          />
        ) : null}
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
    </div>
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
  onDayCountChange,
}: {
  className: string;
  deckId: DeckId;
  dayCount: number;
  dailySize: number;
  totalWords: number;
  onDeckChange: (deckId: DeckId) => void;
  onDayCountChange: (days: number) => void;
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
      <label>
        <span>计划天数</span>
        <input
          type="number"
          min="1"
          max={Math.max(totalWords, 1)}
          value={dayCount}
          onChange={(event) => onDayCountChange(Number(event.target.value))}
        />
      </label>
      <p>
        共 {totalWords} 词 · 每天约 {dailySize} 词
      </p>
    </section>
  );
}

function PlanView({
  words,
  day,
  dayCount,
  dailySize,
  deckName,
  onSelectDay,
}: {
  words: VocabWord[];
  day: number;
  dayCount: number;
  dailySize: number;
  deckName: string;
  onSelectDay: (day: number) => void;
}) {
  return (
    <section className="secondary-view">
      <div className="view-heading">
        <div>
          <h1>{deckName} · 学习计划</h1>
          <p>
            共 {words.length} 个词，分成 {dayCount}{' '}
            天；修改计划天数后会自动重新分组。
          </p>
        </div>
        <CalendarDays />
      </div>
      <div className="plan-grid">
        {Array.from({ length: dayCount }, (_, i) => i + 1).map((number) => {
          const start = (number - 1) * dailySize;
          const count = words.slice(
            start,
            Math.min(start + dailySize, words.length)
          ).length;
          return (
            <button
              key={number}
              className={day === number ? 'plan-day current' : 'plan-day'}
              onClick={() => onSelectDay(number)}
            >
              <span>DAY {String(number).padStart(2, '0')}</span>
              <strong>{count}</strong>
              <small>个词</small>
              <i style={{ width: count ? '100%' : '0%' }} />
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
          <h1>随机分组</h1>
          <p>从全部词汇中打散抽取，适合脱离顺序后的强化检查。</p>
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
          生成新分组
        </button>
      </div>
      {words.length ? (
        <div className="word-list">
          {words.map((word, index) => (
            <div key={word.id}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{word.word}</strong>
              <p>{word.meaning}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="large-empty">
          <Shuffle />
          <h2>还没有随机分组</h2>
          <p>选择数量并生成一组词汇。</p>
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
  return (
    <section className="secondary-view">
      <div className="view-heading">
        <div>
          <h1>错词本</h1>
          <p>“模糊”和“不认识”的词会自动汇集到这里。</p>
        </div>
        <ListRestart />
      </div>
      {words.length ? (
        <div className="word-list">
          {words.map((word) => (
            <div key={word.id}>
              <span className={ratings[word.id]}>
                {ratings[word.id] === 'fuzzy' ? '模糊' : '生词'}
              </span>
              <strong>{word.word}</strong>
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
