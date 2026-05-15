'use strict';

// ── Config ─────────────────────────────────────────────

const AI_CATS = ['AI 모델','AI 하드웨어','AI 정책','AI 로봇','AI 연구','AI 도구','일반 AI'];

const SN_CATS = [
    { id: 'indices', label: '📊 주요 지수' },
    { id: 'us',      label: '🏢 미국 대형주' },
    { id: 'chip',    label: '💾 반도체' },
    { id: 'ev',      label: '⚡ 전기차' },
    { id: 'etf',     label: '📈 ETF' },
    { id: 'small',   label: '🔹 소형주' },
];

const STOCK_CATS = [
    { id: 'indices', label: '📊 주요 지수' },
    { id: 'us',      label: '🏢 미국 대형주' },
    { id: 'chip',    label: '💾 반도체' },
    { id: 'ev',      label: '⚡ 전기차' },
    { id: 'etf',     label: '📈 ETF' },
    { id: 'small',   label: '🔹 소형주' },
];

const KR_NAMES = {
    '^GSPC':'S&P 500','^IXIC':'NASDAQ','^DJI':'다우존스','^RUT':'러셀 2000',
    'AAPL':'애플','MSFT':'마이크로소프트','GOOGL':'구글','AMZN':'아마존',
    'META':'메타','NVDA':'엔비디아','TSLA':'테슬라','NFLX':'넷플릭스',
    'ORCL':'오라클','AMD':'AMD','INTC':'인텔','QCOM':'퀄컴',
    'TSM':'TSMC','ASML':'ASML','MU':'마이크론','AVGO':'브로드컴','AMAT':'어플라이드 머티리얼스',
    'RIVN':'리비안','LCID':'루시드','NIO':'니오','XPEV':'샤오펑',
    'SPY':'S&P500 ETF','QQQ':'NASDAQ100 ETF','VTI':'미국 전체 주식',
    'GLD':'금 ETF','IWM':'러셀2000 ETF','ARKK':'ARK 혁신 ETF','SOXL':'반도체 3X ETF',
    'PLTR':'팔란티어','COIN':'코인베이스','RBLX':'로블록스','APP':'앱러빈',
    'HOOD':'로빈후드','SOFI':'소파이','IONQ':'아이온큐','RDDT':'레딧',
    'SOUN':'사운드하운드','UPST':'업스타트',
};

const TICKER_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1'];

// ── State ──────────────────────────────────────────────

let currentView     = 'ai';
let currentAICat    = null;
let currentSNCat    = 'us';
let currentStockCat = 'indices';
let loadedStockCat  = null;   // 현재 그리드에 렌더된 카테고리
let allAIArticles   = [];
let stockRefreshTimer = null;

// ── Translation ────────────────────────────────────────

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=';
const trCache = {};

async function translate(text) {
    if (!text?.trim()) return text;
    const key = text.slice(0, 100);
    if (trCache[key]) return trCache[key];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
        const res = await fetch(TRANSLATE_URL + encodeURIComponent(text.slice(0, 500)), { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return text;
        const data = await res.json();
        const result = data[0]?.map(s => s[0]).join('') || text;
        trCache[key] = result;
        return result;
    } catch { clearTimeout(timer); return text; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Progressive render + translate ─────────────────────
// Renders all items immediately in English, then translates
// titles in background and updates DOM progressively.

async function renderAndTranslateList(articles, containerEl, theme) {
    if (!articles.length) {
        containerEl.innerHTML = '<p class="no-results">뉴스가 없습니다.</p>';
        return;
    }
    containerEl.innerHTML = articles.map((a, i) => renderNewsListItem(a, theme, i)).join('');

    const BATCH = 6;
    for (let i = 0; i < articles.length; i += BATCH) {
        if (!containerEl.isConnected) return;
        await Promise.all(articles.slice(i, i + BATCH).map(async (a, bi) => {
            const idx = i + bi;
            const kr = await translate(a.title).catch(() => a.title);
            articles[idx] = { ...articles[idx], title: kr };
            const el = containerEl.querySelector(`[data-idx="${idx}"] .nl-title`);
            if (el) { el.textContent = kr; el.classList.remove('translating'); }
        }));
        if (i + BATCH < articles.length) await sleep(150);
    }
}

// ── AI View ────────────────────────────────────────────

async function loadAINews() {
    showAILoading('뉴스를 불러오는 중...');
    hide('ai-overview'); hide('ai-detail'); hide('ai-error');

    let raw;
    try {
        const res = await fetch('/api/news');
        if (!res.ok) throw new Error();
        raw = (await res.json()).articles || [];
    } catch {
        hideAILoading(); showAIError('뉴스를 불러오는데 실패했습니다.'); return;
    }

    allAIArticles = raw;
    hideAILoading();
    renderAICatOverview();
    show('ai-overview');
    updateLastUpdated();
    translateAIOverviewTitles();
}

function renderAICatOverview() {
    const bar = document.getElementById('ai-cat-bar');
    bar.innerHTML = '';
    AI_CATS.forEach(cat => {
        const count = allAIArticles.filter(a => a.aiCategory === cat).length;
        if (count === 0) return;
        const btn = document.createElement('button');
        btn.className = 'news-cat-btn';
        btn.textContent = `${cat} (${count})`;
        btn.addEventListener('click', () => showAICatDetail(cat));
        bar.appendChild(btn);
    });

    const grid = document.getElementById('ai-overview-grid');
    grid.innerHTML = '';
    AI_CATS.forEach(cat => {
        const articles = allAIArticles.filter(a => a.aiCategory === cat);
        if (!articles.length) return;
        const latest = articles[0];
        const img = validImg(latest.thumbnail);
        const card = document.createElement('div');
        card.className = 'cat-card';
        card.innerHTML = `
            <div class="cat-card-head">
                <span class="cat-card-label">${eh(cat)}</span>
                <span class="cat-card-count">${articles.length}개</span>
            </div>
            ${img
                ? `<img class="cat-card-img" src="${ea(img)}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : `<div class="cat-card-img-placeholder"></div>`}
            <div class="cat-card-body">
                <div class="cat-card-title" data-ov-cat="${ea(cat)}">${eh(latest.title)}</div>
                <div class="cat-card-meta">
                    <span>${eh(latest.sourceName)}</span>
                    <span>${formatDate(latest.pubDate)}</span>
                </div>
            </div>
            <span class="cat-card-more">목록 보기 →</span>`;
        card.addEventListener('click', () => showAICatDetail(cat));
        grid.appendChild(card);
    });
}

async function translateAIOverviewTitles() {
    for (const cat of AI_CATS) {
        const articles = allAIArticles.filter(a => a.aiCategory === cat);
        if (!articles.length) continue;
        const latest = articles[0];
        const kr = await translate(latest.title).catch(() => latest.title);
        if (kr !== latest.title) {
            latest.title = kr;
            const el = document.querySelector(`[data-ov-cat="${ea(cat)}"]`);
            if (el) el.textContent = kr;
        }
    }
}

function showAICatDetail(cat) {
    currentAICat = cat;
    hide('ai-overview');
    document.getElementById('ai-detail-title').textContent = cat;
    document.getElementById('ai-search').value = '';
    hide('ai-search-count');

    const articles = allAIArticles.filter(a => a.aiCategory === cat).map(a => ({ ...a }));
    const container = document.getElementById('ai-detail-list');
    renderAndTranslateList(articles, container, 'blue');
    show('ai-detail');
}

document.getElementById('ai-back-btn').addEventListener('click', () => {
    currentAICat = null;
    hide('ai-detail');
    show('ai-overview');
});

// ── Stock News View ────────────────────────────────────

async function loadStockNews(catId) {
    currentSNCat = catId;
    document.querySelectorAll('#sn-cat-bar .news-cat-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.cat === catId));

    showSNLoading('뉴스를 불러오는 중...');
    hide('sn-error');
    document.getElementById('sn-list').innerHTML = '';
    document.getElementById('sn-search').value = '';
    hide('sn-search-count');

    let raw;
    try {
        const res = await fetch(`/api/stock-news?cat=${catId}`);
        if (!res.ok) throw new Error();
        raw = (await res.json()).news || [];
    } catch {
        hideSNLoading(); showSNError('뉴스를 불러오는데 실패했습니다.'); return;
    }

    hideSNLoading();
    const articles = raw.map(a => ({ ...a }));
    renderAndTranslateList(articles, document.getElementById('sn-list'), 'green');
    updateLastUpdated();
}

// ── Stock Tracker View ─────────────────────────────────

async function loadStocks(catId) {
    const catChanged = loadedStockCat !== catId;
    currentStockCat = catId;

    document.querySelectorAll('#stock-cats .stock-cat-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.cat === catId));

    const grid = document.getElementById('stock-grid');
    const needFullRender = catChanged || grid.children.length === 0;

    if (needFullRender) {
        loadedStockCat = catId;
        show('stock-loading'); hide('stock-error');
        grid.innerHTML = '';
        document.getElementById('stock-search').value = '';
        document.getElementById('stock-search-clear').classList.remove('visible');
    }

    let quotes, rate;
    try {
        const res = await fetch(`/api/stocks?cat=${catId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        quotes = data.quotes || [];
        rate   = data.usdKrwRate;
    } catch {
        if (needFullRender) { hide('stock-loading'); showStockError('주식 데이터를 불러오는데 실패했습니다.'); }
        scheduleStockRefresh();
        return;
    }

    if (needFullRender) {
        hide('stock-loading');
        if (!quotes.length) { showStockError('데이터가 없습니다.'); return; }
        grid.innerHTML = quotes.map(renderStockCard).join('');
    } else {
        // 카드 DOM을 유지하고 수치만 업데이트 (깜빡임 없음)
        Array.from(grid.children).forEach((card, i) => {
            if (quotes[i] && card.dataset.symbol === quotes[i].symbol) {
                updateStockCardInPlace(quotes[i], card);
            }
        });
    }

    updateMarketStatus(quotes[0]?.marketState, rate);
    updateLastUpdated();
    scheduleStockRefresh();
}

function scheduleStockRefresh() {
    clearTimeout(stockRefreshTimer);
    stockRefreshTimer = setTimeout(() => loadStocks(currentStockCat), 15 * 1000);
}

function updateStockCardInPlace(q, card) {
    const d   = dir(q.change);
    const krw = q.priceKrw != null ? '₩' + q.priceKrw.toLocaleString('ko-KR') : '--';
    const usd = q.price    != null ? '$' + q.price.toFixed(2) : '';
    const changePctStr = fmtPct(q.changePct);
    const changeBg     = d === 'up' ? '#dcfce7' : d === 'down' ? '#fee2e2' : '#f1f5f9';
    const changeColor  = d === 'up' ? '#16a34a' : d === 'down' ? '#dc2626' : '#94a3b8';

    const priceEl  = card.querySelector('.sc-price-krw');
    const prevKrw  = priceEl?.textContent;

    // 방향 클래스 업데이트
    card.className = `stock-card ${d}`;

    // 차트 모달용 data 속성 업데이트
    card.dataset.priceKrw    = krw;
    card.dataset.priceUsd    = usd;
    card.dataset.changePct   = changePctStr;
    card.dataset.changeBg    = changeBg;
    card.dataset.changeColor = changeColor;

    // DOM 수치 업데이트
    if (priceEl) priceEl.textContent = krw;
    const usdEl = card.querySelector('.sc-price-usd');
    if (usdEl) usdEl.textContent = usd;
    const pctEl = card.querySelector('.sc-pct');
    if (pctEl) pctEl.textContent = changePctStr;
    const arrowEl = card.querySelector('.sc-arrow');
    if (arrowEl) arrowEl.textContent = arrow(q.change);
    const absEl = card.querySelector('.sc-abs');
    if (absEl && q.changeKrw != null) absEl.textContent = '₩' + Math.abs(q.changeKrw).toLocaleString('ko-KR');

    // 가격이 바뀌었을 때만 플래시 애니메이션
    if (priceEl && prevKrw && prevKrw !== krw) {
        priceEl.classList.remove('price-up-flash', 'price-dn-flash');
        void priceEl.offsetWidth; // reflow 강제
        priceEl.classList.add(q.change >= 0 ? 'price-up-flash' : 'price-dn-flash');
    }
}

// ── Chart Modal ────────────────────────────────────────

let chartInstance  = null;
let modalSymbol    = null;
let modalRange     = '1mo';

document.getElementById('stock-grid').addEventListener('click', e => {
    const card = e.target.closest('.stock-card[data-symbol]');
    if (!card) return;
    openChartModal(card.dataset);
});

function openChartModal(d) {
    modalSymbol = d.symbol;
    modalRange  = '1mo';

    document.getElementById('modal-badge').textContent = d.symbol.replace('^','').slice(0,4);
    document.getElementById('modal-badge').style.background = d.color;
    document.getElementById('modal-ticker').textContent = d.symbol.replace('^','');
    document.getElementById('modal-name').textContent = d.name;
    document.getElementById('modal-price-krw').textContent = d.priceKrw;
    document.getElementById('modal-price-usd').textContent = d.priceUsd;

    const badge = document.getElementById('modal-change-badge');
    badge.textContent = d.changePct;
    badge.style.background = d.changeBg;
    badge.style.color = d.changeColor;

    document.querySelectorAll('.range-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.range === '1mo'));

    show('chart-modal');
    loadChart(modalSymbol, '1mo');
}

async function loadChart(symbol, range) {
    show('chart-loading-overlay');
    try {
        const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        renderChart(data.quotes || []);
    } catch {
        hide('chart-loading-overlay');
    }
}

function renderChart(quotes) {
    hide('chart-loading-overlay');
    if (!quotes.length) return;

    const labels = quotes.map(q => {
        const d = new Date(q.t);
        return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    });
    const prices = quotes.map(q => q.c);
    const isUp   = prices[prices.length - 1] >= prices[0];
    const color  = isUp ? '#16a34a' : '#dc2626';
    const bgColor = isUp ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)';

    const ctx = document.getElementById('price-chart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: prices,
                borderColor: color,
                backgroundColor: bgColor,
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: color,
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleColor: '#94a3b8',
                    bodyColor: '#fff',
                    padding: 10,
                    callbacks: {
                        label: ctx => `$${ctx.parsed.y.toFixed(2)}`,
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 7, font: { size: 11 }, color: '#94a3b8' }
                },
                y: {
                    position: 'right',
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        font: { size: 11 }, color: '#94a3b8',
                        callback: v => '$' + v.toLocaleString()
                    }
                }
            }
        }
    });
}

document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        modalRange = btn.dataset.range;
        loadChart(modalSymbol, modalRange);
    });
});

document.getElementById('modal-close').addEventListener('click', closeChartModal);
document.getElementById('chart-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('chart-modal')) closeChartModal();
});

function closeChartModal() {
    hide('chart-modal');
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
}

// Keyboard ESC closes modal
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeChartModal();
});

// ── Search ─────────────────────────────────────────────

function setupNewsSearch(inputId, clearId, countId, getItems) {
    const input    = document.getElementById(inputId);
    const clearBtn = document.getElementById(clearId);
    const countEl  = document.getElementById(countId);
    if (!input) return;

    const run = () => {
        const q = input.value.toLowerCase().trim();
        clearBtn.classList.toggle('visible', q.length > 0);
        const items = getItems();
        let visible = 0;
        items.forEach(el => {
            if (!q) { el.style.display = ''; visible++; return; }
            const title  = el.querySelector('.nl-title')?.textContent.toLowerCase()  || '';
            const source = el.querySelector('.nl-source')?.textContent.toLowerCase() || '';
            const sym    = el.querySelector('.nl-sym')?.textContent.toLowerCase()    || '';
            const match  = title.includes(q) || source.includes(q) || sym.includes(q);
            el.style.display = match ? '' : 'none';
            if (match) visible++;
        });
        if (q && items.length) {
            countEl.textContent = `${visible} / ${items.length}건 표시 중`;
            show(countId);
        } else {
            hide(countId);
        }
    };

    input.addEventListener('input', run);
    clearBtn?.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
}

function setupStockSearch() {
    const input    = document.getElementById('stock-search');
    const clearBtn = document.getElementById('stock-search-clear');
    if (!input) return;

    const run = () => {
        const q = input.value.toLowerCase().trim();
        clearBtn.classList.toggle('visible', q.length > 0);
        document.querySelectorAll('.stock-card').forEach(el => {
            if (!q) { el.style.display = ''; return; }
            const sym  = el.querySelector('.sc-ticker')?.textContent.toLowerCase() || '';
            const name = el.querySelector('.sc-name')?.textContent.toLowerCase()   || '';
            el.style.display = (sym.includes(q) || name.includes(q)) ? '' : 'none';
        });
    };

    input.addEventListener('input', run);
    clearBtn?.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
}

// ── Renderers ──────────────────────────────────────────

function renderNewsListItem(a, theme = 'blue', idx = -1) {
    const img = validImg(a.thumbnail);
    const sym = a.symbol || '';
    return `
        <a href="${ea(a.link)}" target="_blank" rel="noopener noreferrer" class="nl-item" data-idx="${idx}">
            ${img ? `<img class="nl-img" src="${ea(img)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <div class="nl-body">
                <div class="nl-meta">
                    <span class="nl-source ${theme === 'green' ? 'green' : ''}">${eh(a.sourceName)}</span>
                    ${sym ? `<span class="nl-sym">${eh(sym.replace('^',''))}</span>` : ''}
                    <span class="nl-date">${formatDate(a.pubDate)}</span>
                </div>
                <div class="nl-title translating">${eh(a.title)}</div>
            </div>
        </a>`;
}

function renderStockCard(q) {
    const d = dir(q.change);
    const name = KR_NAMES[q.symbol] || q.shortName;
    const color = tickerColor(q.symbol);
    const pct = rangePct(q.price, q.low52, q.high52);
    const krw = q.priceKrw != null ? '₩' + q.priceKrw.toLocaleString('ko-KR') : '--';
    const usd = q.price    != null ? '$' + q.price.toFixed(2) : '';
    const changePctStr = fmtPct(q.changePct);
    const changeBg    = d === 'up' ? '#dcfce7' : d === 'down' ? '#fee2e2' : '#f1f5f9';
    const changeColor = d === 'up' ? '#16a34a' : d === 'down' ? '#dc2626' : '#94a3b8';

    return `
        <div class="stock-card ${d}"
            data-symbol="${ea(q.symbol)}"
            data-name="${ea(name)}"
            data-price-krw="${ea(krw)}"
            data-price-usd="${ea(usd)}"
            data-change-pct="${ea(changePctStr)}"
            data-change-bg="${ea(changeBg)}"
            data-change-color="${ea(changeColor)}"
            data-color="${ea(color)}">
            <div class="sc-header">
                <div class="sc-badge" style="background:${color}">${tickerLabel(q.symbol)}</div>
                <div class="sc-info">
                    <div class="sc-ticker">${eh(q.symbol.replace('^',''))}</div>
                    <div class="sc-name">${eh(name)}</div>
                </div>
            </div>
            <div>
                <div class="sc-price-krw">${krw}</div>
                ${usd ? `<div class="sc-price-usd">${usd}</div>` : ''}
            </div>
            <div class="sc-change">
                <span class="sc-arrow">${arrow(q.change)}</span>
                <span class="sc-pct">${changePctStr}</span>
                ${q.changeKrw != null ? `<span class="sc-abs">₩${Math.abs(q.changeKrw).toLocaleString('ko-KR')}</span>` : ''}
            </div>
            ${q.high52 && q.low52 ? `
            <div class="sc-range">
                <div class="sc-range-bar-wrap">
                    <div class="sc-range-bar" style="width:${pct.toFixed(1)}%"></div>
                </div>
                <div class="sc-range-labels">
                    <span>52주 저: ₩${Math.round(q.low52*(q.usdKrwRate||1)).toLocaleString('ko-KR')}</span>
                    <span>고: ₩${Math.round(q.high52*(q.usdKrwRate||1)).toLocaleString('ko-KR')}</span>
                </div>
            </div>` : ''}
            <div class="sc-chart-hint">📈 클릭하여 차트 보기</div>
        </div>`;
}

function updateMarketStatus(state, rate) {
    const MAP = {
        REGULAR: { cls: 'open',   text: '미국 장중' },
        PRE:     { cls: 'pre',    text: '프리마켓' },
        POST:    { cls: 'post',   text: '애프터마켓' },
        CLOSED:  { cls: 'closed', text: '장마감' },
    };
    const m = MAP[state] || MAP.CLOSED;
    document.getElementById('market-dot').className = `market-dot ${m.cls}`;
    document.getElementById('market-label').textContent = m.text;
    if (rate) {
        const el = document.getElementById('krw-rate');
        el.textContent = `$1 = ₩${Math.round(rate).toLocaleString('ko-KR')} (라이브)`;
        el.title = '실시간 외환 스팟 환율 기준입니다. 국내 증권사(토스 등)는 하루 한 번 고정되는 매매기준율을 사용하므로 원화 환산 금액이 약 2~4% 다를 수 있습니다.';
    }
}

// ── View Switching ─────────────────────────────────────

function switchView(view) {
    currentView = view;
    ['ai-view','sn-view','stocks-view'].forEach(id => hide(id));

    if (view === 'ai') {
        show('ai-view');
        if (allAIArticles.length === 0) loadAINews();
    } else if (view === 'stock') {
        show('sn-view');
        loadStockNews(currentSNCat);
    } else {
        show('stocks-view');
        loadStocks(currentStockCat);
    }
}

// ── Helpers ────────────────────────────────────────────

function tickerColor(sym) {
    let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) & 0xff;
    return TICKER_COLORS[h % TICKER_COLORS.length];
}
function tickerLabel(sym) { return sym.replace('^','').slice(0,4); }
function fmtPct(p)  { return p == null ? '--' : (p >= 0 ? '+' : '') + p.toFixed(2) + '%'; }
function dir(c)     { return c == null ? 'flat' : c > 0 ? 'up' : c < 0 ? 'down' : 'flat'; }
function arrow(c)   { return c > 0 ? '▲' : c < 0 ? '▼' : '―'; }
function validImg(u){ return u?.startsWith('http') ? u : null; }
function rangePct(p, lo, hi) {
    if (!lo || !hi || hi === lo) return 0;
    return Math.min(100, Math.max(0, ((p - lo) / (hi - lo)) * 100));
}
function formatDate(s) {
    if (!s) return '';
    try {
        const d = new Date(s); if (isNaN(d)) return '';
        const m = (Date.now() - d) / 60000;
        if (m < 1)    return '방금 전';
        if (m < 60)   return `${Math.floor(m)}분 전`;
        if (m < 1440) return `${Math.floor(m/60)}시간 전`;
        return d.toLocaleDateString('ko-KR', { month:'short', day:'numeric' });
    } catch { return ''; }
}
function updateLastUpdated() {
    const t = new Date().toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
    document.getElementById('last-updated').textContent = `업데이트: ${t}`;
}
function eh(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function ea(s) { return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function showAILoading(t)  { document.getElementById('ai-loading-text').textContent = t; show('ai-loading'); }
function hideAILoading()   { hide('ai-loading'); }
function showAIError(m)    { document.getElementById('ai-error').textContent = m; show('ai-error'); }
function showSNLoading(t)  { document.getElementById('sn-loading-text').textContent = t; show('sn-loading'); }
function hideSNLoading()   { hide('sn-loading'); }
function showSNError(m)    { document.getElementById('sn-error').innerHTML = m; show('sn-error'); }
function showStockError(m) { document.getElementById('stock-error').innerHTML = m; show('stock-error'); }

// ── Build Dynamic Buttons ──────────────────────────────

const snBar = document.getElementById('sn-cat-bar');
SN_CATS.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'news-cat-btn' + (cat.id === currentSNCat ? ' active' : '');
    btn.dataset.cat = cat.id;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => loadStockNews(cat.id));
    snBar.appendChild(btn);
});

const stockCatsEl = document.getElementById('stock-cats');
STOCK_CATS.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'stock-cat-btn' + (cat.id === currentStockCat ? ' active' : '');
    btn.dataset.cat = cat.id;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => loadStocks(cat.id));
    stockCatsEl.appendChild(btn);
});

// ── Search Setup ───────────────────────────────────────

setupNewsSearch('ai-search', 'ai-search-clear', 'ai-search-count',
    () => document.querySelectorAll('#ai-detail-list .nl-item'));

setupNewsSearch('sn-search', 'sn-search-clear', 'sn-search-count',
    () => document.querySelectorAll('#sn-list .nl-item'));

setupStockSearch();

// ── Events ─────────────────────────────────────────────

document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        switchView({ ai: 'ai', stock: 'stock', stocks: 'stocks' }[btn.dataset.category]);
    });
});

document.getElementById('refresh-btn').addEventListener('click', () => {
    if (currentView === 'ai')     { allAIArticles = []; loadAINews(); }
    if (currentView === 'stock')  loadStockNews(currentSNCat);
    if (currentView === 'stocks') loadStocks(currentStockCat);
});

// ── Init ───────────────────────────────────────────────

switchView('ai');
