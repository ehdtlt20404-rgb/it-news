const express      = require('express');
const RSSParser    = require('rss-parser');
const YahooFinance = require('yahoo-finance2').default;
const cron         = require('node-cron');
const path         = require('path');

const app = express();
const PORT = 3000;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// ── RSS Parser ──────────────────────────────────────────

const parser = new RSSParser({
    timeout: 10000,
    customFields: { item: [['media:thumbnail','mediaThumbnail'],['media:content','mediaContent']] }
});

// ── Feed / Symbol Config ────────────────────────────────

const NEWS_FEEDS = {
    ai: [
        { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', name: 'TechCrunch' },
        { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', name: 'The Verge' },
        { url: 'https://venturebeat.com/category/ai/feed/', name: 'VentureBeat' },
        { url: 'https://www.technologyreview.com/feed/', name: 'MIT Tech Review' },
        { url: 'https://feeds.feedburner.com/oreilly/radar', name: "O'Reilly Radar" },
        { url: 'https://www.wired.com/feed/tag/ai/latest/rss', name: 'Wired' },
        { url: 'https://arstechnica.com/ai/feed/', name: 'Ars Technica' },
        { url: 'https://techcrunch.com/feed/', name: 'TechCrunch (전체)' },
    ],
    code: [
        { url: 'https://github.blog/feed/', name: 'GitHub Blog' },
        { url: 'https://stackoverflow.blog/feed/', name: 'Stack Overflow' },
        { url: 'https://dev.to/feed', name: 'Dev.to' },
        { url: 'https://www.smashingmagazine.com/feed/', name: 'Smashing Magazine' },
        { url: 'https://css-tricks.com/feed/', name: 'CSS-Tricks' },
        { url: 'https://www.infoq.com/feed/', name: 'InfoQ' },
        { url: 'https://news.ycombinator.com/rss', name: 'Hacker News' },
        { url: 'https://arstechnica.com/gadgets/feed/', name: 'Ars Technica Dev' },
    ]
};

const STOCK_CATS = {
    indices: ['^GSPC', '^IXIC', '^DJI', '^RUT'],
    us:      ['AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA','NFLX','ORCL','AMD'],
    chip:    ['NVDA','AMD','INTC','QCOM','TSM','ASML','MU','AVGO','AMAT'],
    ev:      ['TSLA','RIVN','LCID','NIO','XPEV'],
    etf:     ['SPY','QQQ','VTI','GLD','IWM','ARKK','SOXL'],
    small:   ['PLTR','COIN','RBLX','APP','HOOD','SOFI','IONQ','RDDT','SOUN','UPST'],
};

// Stock news uses all symbols per category
const STOCK_NEWS_SYMS = STOCK_CATS;

// ── Caches ──────────────────────────────────────────────

const cache = {};
const NEWS_TTL  =  5 * 60 * 1000;
const STOCK_TTL = 15 * 1000;        // 15초 캐시 (실시간 갱신)
const CHART_TTL =  5 * 60 * 1000;

// ── Exchange Rate ───────────────────────────────────────

let usdKrwRate = 1380;

async function updateKrwRate() {
    try {
        const q = await yahooFinance.quote('USDKRW=X');
        if (q?.regularMarketPrice) {
            usdKrwRate = q.regularMarketPrice;
            console.log(`[FX] 1 USD = ₩${Math.round(usdKrwRate)}`);
        }
    } catch (e) {
        console.warn('[FX] 환율 조회 실패:', e.message);
    }
}

// ── Code Categorizer ────────────────────────────────────

function categorizeCode(title = '', desc = '') {
    const t = (title + ' ' + desc).toLowerCase();
    if (/copilot|cursor|vibe.?cod|ai.?cod|codeium|tabnine|windsurf|replit|lovable|bolt\.new|v0\.dev|devin|swe.?agent|agentic.?cod|code.?gen|code.?assist|ghostwriter/.test(t)) return 'AI 코딩 도구';
    if (/react|vue|angular|next\.js|svelte|remix|astro|css|html|frontend|web.?dev|javascript|typescript|node\.js/.test(t)) return '웹 개발';
    if (/docker|kubernetes|k8s|aws|cloud|gcp|azure|backend|graphql|rest.?api|database|postgres|mysql|redis|devops|ci.?cd|terraform/.test(t)) return '백엔드/인프라';
    if (/open.?source|github|git|npm|package|library|framework|sdk|release|version \d/.test(t)) return '오픈소스';
    if (/rust|python|go\b|golang|java\b|swift|kotlin|c\+\+|ruby|php|programming language|compiler|wasm|webassembly/.test(t)) return '프로그래밍 언어';
    if (/security|vulnerab|exploit|patch|cve|breach|hack/.test(t)) return '보안';
    return '개발 트렌드';
}

// ── AI Categorizer ──────────────────────────────────────

function categorizeAI(title = '', desc = '') {
    const t = (title + ' ' + desc).toLowerCase();
    if (/gpt|claude|gemini|llama|mistral|chatgpt|llm|openai|anthropic|deepmind|language model|chatbot|ai model/.test(t)) return 'AI 모델';
    if (/nvidia|gpu|\bchip\b|hardware|h100|blackwell|npu|tpu|data center/.test(t)) return 'AI 하드웨어';
    if (/regulat|policy|government|congress|eu ai|legislation|ban|safety|ethic|copyright/.test(t)) return 'AI 정책';
    if (/robot|autonom|self.driv|drone|humanoid|boston dynamic|optimus|physical ai/.test(t)) return 'AI 로봇';
    if (/research|paper|study|scientist|benchmark|dataset|arxiv|university/.test(t)) return 'AI 연구';
    if (/tool|app|product|launch|release|feature|update|integrat|plugin|api/.test(t)) return 'AI 도구';
    return '일반 AI';
}

// ── Helpers ─────────────────────────────────────────────

function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), ms))]);
}

// ── News (Code) ─────────────────────────────────────────

async function fetchCodeNews() {
    const now = Date.now();
    if (cache['code'] && now - cache['code'].ts < NEWS_TTL) return cache['code'].data;

    console.log('[fetch] 코딩 뉴스 수집 중...');
    const results = await Promise.allSettled(NEWS_FEEDS.code.map(fetchFeed));
    const articles = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value)
        .filter(a => a.title && a.link)
        .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

    const seen = new Set();
    const unique = articles.filter(a => {
        const k = a.title.slice(0, 60).toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
    }).slice(0, 120);

    unique.forEach(a => { a.codeCategory = categorizeCode(a.title, a.description); });

    console.log(`[done] 코딩: ${unique.length}개`);
    cache['code'] = { data: unique, ts: now };
    return unique;
}

// ── News (AI) ───────────────────────────────────────────

async function fetchFeed(feedInfo) {
    try {
        const feed = await withTimeout(parser.parseURL(feedInfo.url), 10000);
        return feed.items.map(item => ({
            title:       (item.title || '').trim(),
            link:        item.link || item.guid || '',
            description: item.contentSnippet || item.summary || '',
            pubDate:     item.pubDate || item.isoDate || '',
            thumbnail:   item.mediaThumbnail?.$?.url || item.mediaContent?.$?.url || item.enclosure?.url || '',
            sourceName:  feedInfo.name,
        })).filter(i => i.title && i.link);
    } catch (e) {
        console.warn(`  [skip] ${feedInfo.name}: ${e.message}`);
        return [];
    }
}

async function fetchAINews() {
    const now = Date.now();
    if (cache['ai'] && now - cache['ai'].ts < NEWS_TTL) return cache['ai'].data;

    console.log('[fetch] AI 뉴스 수집 중...');
    const results = await Promise.allSettled(NEWS_FEEDS.ai.map(fetchFeed));
    const articles = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value)
        .filter(a => a.title && a.link)
        .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

    const seen = new Set();
    const unique = articles.filter(a => {
        const k = a.title.slice(0, 60).toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
    }).slice(0, 120);

    unique.forEach(a => { a.aiCategory = categorizeAI(a.title, a.description); });

    console.log(`[done] AI: ${unique.length}개`);
    cache['ai'] = { data: unique, ts: now };
    return unique;
}

// ── Stock News ───────────────────────────────────────────

async function fetchStockNews(cat) {
    const symbols = STOCK_NEWS_SYMS[cat];
    if (!symbols) return [];

    const cacheKey = `sn-${cat}`;
    const now = Date.now();
    if (cache[cacheKey] && now - cache[cacheKey].ts < NEWS_TTL) return cache[cacheKey].data;

    console.log(`[stock-news] ${cat} 수집 중...`);
    const results = await Promise.allSettled(
        symbols.map(async sym => {
            const r = await withTimeout(
                yahooFinance.search(sym, { quotesCount: 0, newsCount: 10 }),
                8000
            );
            return (r.news || []).map(n => ({
                title:      n.title || '',
                link:       n.link  || '',
                pubDate:    new Date((n.providerPublishTime || 0) * 1000).toISOString(),
                thumbnail:  n.thumbnail?.resolutions?.[0]?.url || '',
                sourceName: n.publisher || '',
                symbol:     sym,
            }));
        })
    );

    const seen = new Set();
    const news = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value)
        .filter(n => n.title && n.link && !seen.has(n.title) && seen.add(n.title))
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
        .slice(0, 100);

    console.log(`[stock-news] ${cat}: ${news.length}개`);
    cache[cacheKey] = { data: news, ts: now };
    return news;
}

// ── Stock Quotes ────────────────────────────────────────

async function fetchStocks(cat) {
    const symbols = STOCK_CATS[cat];
    if (!symbols) return [];

    const cacheKey = `stocks-${cat}`;
    const now = Date.now();
    if (cache[cacheKey] && now - cache[cacheKey].ts < STOCK_TTL) return cache[cacheKey].data;

    console.log(`[stocks] ${cat} 조회 중...`);
    const raw = await yahooFinance.quote(symbols);
    const list = Array.isArray(raw) ? raw : [raw];

    const quotes = list.map(q => ({
        symbol:      q.symbol,
        shortName:   q.shortName || q.longName || q.symbol,
        price:       q.regularMarketPrice ?? null,
        priceKrw:    (q.currency === 'USD' && q.regularMarketPrice) ? Math.round(q.regularMarketPrice * usdKrwRate) : null,
        change:      q.regularMarketChange ?? null,
        changeKrw:   (q.currency === 'USD' && q.regularMarketChange) ? Math.round(q.regularMarketChange * usdKrwRate) : null,
        changePct:   q.regularMarketChangePercent ?? null,
        prevClose:   q.regularMarketPreviousClose ?? null,
        high52:      q.fiftyTwoWeekHigh ?? null,
        low52:       q.fiftyTwoWeekLow  ?? null,
        currency:    q.currency || 'USD',
        marketState: q.marketState || 'CLOSED',
        usdKrwRate,
    })).filter(q => q.price !== null);

    console.log(`[stocks] ${cat}: ${quotes.length}개`);
    cache[cacheKey] = { data: quotes, ts: now };
    return quotes;
}

// ── Chart Data ──────────────────────────────────────────

async function fetchChartData(symbol, range) {
    const cacheKey = `chart-${symbol}-${range}`;
    const now = Date.now();
    if (cache[cacheKey] && now - cache[cacheKey].ts < CHART_TTL) return cache[cacheKey].data;

    const rangeConfig = {
        '1mo': { interval: '1d',  days: 30  },
        '3mo': { interval: '1d',  days: 90  },
        '6mo': { interval: '1wk', days: 180 },
        '1y':  { interval: '1wk', days: 365 },
    };
    const cfg = rangeConfig[range] || rangeConfig['1mo'];
    const period1 = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000);

    console.log(`[chart] ${symbol} ${range} 조회 중...`);
    const result = await withTimeout(
        yahooFinance.chart(symbol, { period1, interval: cfg.interval }),
        12000
    );

    const quotes = (result.quotes || [])
        .filter(q => q.close != null)
        .map(q => ({
            t: (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10),
            o: q.open,
            h: q.high,
            l: q.low,
            c: q.close,
            v: q.volume,
        }));

    cache[cacheKey] = { data: quotes, ts: now };
    return quotes;
}

// ── Routes ──────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/news', async (req, res) => {
    try {
        const articles = await fetchAINews();
        res.json({ articles, count: articles.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '뉴스 수집 실패' });
    }
});

app.get('/api/code-news', async (req, res) => {
    try {
        const articles = await fetchCodeNews();
        res.json({ articles, count: articles.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '코딩 뉴스 수집 실패' });
    }
});

app.get('/api/stock-news', async (req, res) => {
    const { cat } = req.query;
    if (!STOCK_NEWS_SYMS[cat]) return res.status(400).json({ error: 'invalid category' });
    try {
        const news = await fetchStockNews(cat);
        res.json({ news });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '주식 뉴스 수집 실패' });
    }
});

app.get('/api/stocks', async (req, res) => {
    const { cat } = req.query;
    if (!STOCK_CATS[cat]) return res.status(400).json({ error: 'invalid category' });
    try {
        const quotes = await fetchStocks(cat);
        res.json({ quotes, usdKrwRate });
    } catch (e) {
        console.error('[Stock Error]', e.message);
        res.status(500).json({ error: '주식 데이터 로드 실패' });
    }
});

app.get('/api/chart', async (req, res) => {
    const { symbol, range = '1mo' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const validRanges = ['1mo','3mo','6mo','1y'];
    if (!validRanges.includes(range)) return res.status(400).json({ error: 'invalid range' });
    try {
        const quotes = await fetchChartData(symbol, range);
        res.json({ quotes });
    } catch (e) {
        console.error('[Chart Error]', symbol, e.message);
        res.status(500).json({ error: '차트 데이터 로드 실패' });
    }
});

// ── Scheduled Sync (매일 오전 7시 30분, 한국 시간 / 10시 백업) ────────────

let lastSyncDate = null;

function todayKST() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function doSync(label) {
    console.log(`\n[Cron] ⏰ ${label} 동기화 시작...`);
    Object.keys(cache)
        .filter(k => !k.startsWith('stocks-') && !k.startsWith('chart-'))
        .forEach(k => delete cache[k]);
    await Promise.allSettled([
        updateKrwRate(),
        fetchAINews(),
        fetchCodeNews(),
    ]);
    lastSyncDate = todayKST();
    console.log(`[Cron] ✅ ${label} 동기화 완료\n`);
}

// 7:30 AM KST
cron.schedule('30 7 * * *', async () => {
    if (lastSyncDate !== todayKST()) {
        await doSync('오전 7시 30분');
    } else {
        console.log('[Cron] ⏭ 7시 30분 동기화 생략 (시작 시 이미 완료)');
    }
}, { timezone: 'Asia/Seoul' });

// 10:00 AM KST — 7:30 동기화 미실행 시 백업
cron.schedule('0 10 * * *', async () => {
    if (lastSyncDate !== todayKST()) {
        console.log('[Cron] ⚠️  7시 30분 동기화 미실행 → 10시 백업 동기화 시작');
        await doSync('오전 10시 (백업)');
    } else {
        console.log('[Cron] ⏭ 10시 백업 생략 (오늘 동기화 완료)');
    }
}, { timezone: 'Asia/Seoul' });

// ── Start ───────────────────────────────────────────────

app.listen(PORT, async () => {
    console.log(`\n✅ 서버 실행 중 → http://localhost:${PORT}`);
    console.log('⏰ 매일 오전 7시 30분 (KST) 자동 동기화 예약됨 (미실행 시 10시 백업)\n');
    await updateKrwRate();
    setInterval(updateKrwRate, 5 * 60 * 1000);  // 5분마다 환율 갱신
    await fetchAINews().catch(() => {});
    await fetchCodeNews().catch(() => {});
    lastSyncDate = todayKST();
});
