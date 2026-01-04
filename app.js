import { listTopics, listCardsByTopic, updateCard, seedIfEmpty, clearAll, importJson, getSrs, upsertSrs, createTopic, updateTopic, deleteTopic, getAllCards, getAllSrs, addCardsToTopic } from './db.js';

// Авто-источник: публичная страница Notion с билетами пользователя
const DEFAULT_NOTION_URL = 'https://pollen-jewel-bec.notion.site/1-c-8ec04abc8dba4cebbad42125cde3dba9';

const topicsList = document.getElementById('topicsList');
const empty = document.getElementById('empty');
const cardView = document.getElementById('cardView');
const qEl = document.getElementById('question');
const correctChk = document.getElementById('correctChk');
const nextBtn = document.getElementById('nextCard');
const qInput = document.getElementById('qInput');
const aInput = document.getElementById('aInput');
const saveBtn = document.getElementById('saveCard');
const importBtn = document.getElementById('importBtn');
const fileInput = document.getElementById('fileInput');
const resetBtn = document.getElementById('resetBtn');
// Removed global import - now each deck has its own import button
const createDeckBtn = document.getElementById('createDeckBtn');
const studyAllMode = document.getElementById('studyAllMode');
const deckInfo = document.getElementById('deckInfo');
const deckModal = document.getElementById('deckModal');
const modalTitle = document.getElementById('modalTitle');
const deckNameInput = document.getElementById('deckNameInput');
const deckDescInput = document.getElementById('deckDescInput');
const saveDeckBtn = document.getElementById('saveDeckBtn');
const cancelDeckBtn = document.getElementById('cancelDeckBtn');
const deleteDeckBtn = document.getElementById('deleteDeckBtn');

let currentTopicId = null;
let cards = [];
let index = 0;
let showEditor = true;
let studyAllDecks = false;
let editingTopicId = null;
const srsCache = new Map(); // cardId -> { cardId, level, nextDue }

async function renderTopics(items) {
  topicsList.innerHTML = '';
  
  // Render decks immediately without loading stats to avoid lag
  items.forEach((t) => {
    const li = document.createElement('li');
    if (currentTopicId === t.id && !studyAllDecks) {
      li.classList.add('active');
    }
    
    li.innerHTML = `
      <div class="topic-header">
        <div style="flex: 1;">
          <div class="topic-name">${escapeHtml(t.name)}</div>
          ${t.description ? `<div class="topic-desc">${escapeHtml(t.description)}</div>` : ''}
          <div class="topic-stats" data-topic-id="${t.id}">
            <span>Loading...</span>
          </div>
        </div>
        <div class="topic-actions" onclick="event.stopPropagation()">
          <button onclick="importToDeck('${t.id}')" title="Import from Notion">📥</button>
          <button onclick="editDeck('${t.id}')" title="Edit">✏️</button>
          <button onclick="deleteDeckConfirm('${t.id}')" title="Delete">🗑️</button>
        </div>
      </div>
    `;
    
    li.onclick = async () => {
      studyAllDecks = false;
      studyAllMode.checked = false;
      await loadTopic(t.id, false);
    };
    
    topicsList.appendChild(li);
  });
  
  // Load statistics in the background after rendering to avoid blocking
  setTimeout(async () => {
    const now = Date.now();
    for (const t of items) {
      try {
        const deckCards = await listCardsByTopic(t.id);
        const deckSrs = await Promise.all(deckCards.map(c => getSrs(c.id)));
        const dueCount = deckSrs.filter(srs => !srs || srs.nextDue <= now).length;
        const totalCount = deckCards.length;
        
        const statsEl = document.querySelector(`.topic-stats[data-topic-id="${t.id}"]`);
        if (statsEl) {
          statsEl.innerHTML = `<span>${totalCount} cards</span><span>${dueCount} due</span>`;
        }
      } catch (error) {
        console.error('Error loading stats for deck:', t.id, error);
      }
    }
  }, 0);
}

async function updateCardView() {
  if (!cards.length) {
    cardView.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  cardView.classList.remove('hidden');
  const c = cards[index];
  qEl.textContent = c?.question || '—';
  qInput.value = c?.question || '';
  aInput.value = c?.answer || '';
  const editorBlock = document.querySelector('.editor');
  editorBlock.style.display = showEditor ? '' : 'none';
  
  // Update deck info
  if (studyAllDecks) {
    const currentCard = cards[index];
    const allTopics = await listTopics();
    const cardTopic = allTopics.find(t => t.id === currentCard?.topic_id);
    deckInfo.innerHTML = `<strong>Study All Decks</strong><span>Card from: ${escapeHtml(cardTopic?.name || 'Unknown')}</span>`;
  } else if (currentTopicId) {
    const topic = (await listTopics()).find(t => t.id === currentTopicId);
    const now = Date.now();
    const dueCount = Array.from(srsCache.values()).filter(srs => srs.nextDue <= now).length;
    const totalCount = cards.length;
    deckInfo.innerHTML = `<strong>${escapeHtml(topic?.name || 'Deck')}</strong><span>${dueCount} due / ${totalCount} total</span>`;
  } else {
    deckInfo.innerHTML = '';
  }
}

nextBtn.onclick = async () => {
  if (!cards.length) return;
  const current = cards[index];
  const wasCorrect = !!correctChk.checked;
  await scheduleSrs(current.id, wasCorrect);
  correctChk.checked = false;
  index = pickNextIndex(cards, index);
  await updateCardView();
};
saveBtn.onclick = async () => {
  if (!cards.length) return;
  const c = { ...cards[index], question: qInput.value, answer: aInput.value };
  await updateCard(c);
  cards[index] = c;
  await updateCardView();
};

importBtn.onclick = () => fileInput.click();
fileInput.onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const json = JSON.parse(text);
    await importJson(json);
    await load();
  } catch {}
  fileInput.value = '';
};

resetBtn.onclick = async () => {
  await clearAll();
  // Попробуем подтянуть билеты с публичной страницы Notion
  const data = await fetchNotionPublicPage(DEFAULT_NOTION_URL);
  if (data) await importJson(data);
  await load();
};

// Removed global import - now each deck has its own import button

// Deck management
if (createDeckBtn) {
  createDeckBtn.onclick = () => {
    editingTopicId = null;
    modalTitle.textContent = 'Create New Deck';
    deckNameInput.value = '';
    deckDescInput.value = '';
    deleteDeckBtn.classList.add('hidden');
    deckModal.classList.remove('hidden');
    deckNameInput.focus();
  };
}

saveDeckBtn.onclick = async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const name = deckNameInput.value.trim();
  if (!name) return;
  
  if (editingTopicId) {
    const topics = await listTopics();
    const topic = topics.find(t => t.id === editingTopicId);
    if (topic) {
      topic.name = name;
      topic.description = deckDescInput.value.trim();
      await updateTopic(topic);
    }
  } else {
    const newTopic = {
      id: crypto.randomUUID(),
      name: name,
      description: deckDescInput.value.trim()
    };
    await createTopic(newTopic);
  }
  
  deckModal.classList.add('hidden');
  editingTopicId = null;
  await load();
};

cancelDeckBtn.onclick = () => {
  deckModal.classList.add('hidden');
  editingTopicId = null;
};

deckModal.onclick = (e) => {
  if (e.target === deckModal) {
    deckModal.classList.add('hidden');
    editingTopicId = null;
  }
};

// Prevent modal content clicks from closing modal
// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const modalContent = document.querySelector('.modal-content');
    if (modalContent) {
      modalContent.onclick = (e) => {
        e.stopPropagation();
      };
    }
  });
} else {
  const modalContent = document.querySelector('.modal-content');
  if (modalContent) {
    modalContent.onclick = (e) => {
      e.stopPropagation();
    };
  }
}

deleteDeckBtn.onclick = async () => {
  if (!editingTopicId) return;
  if (confirm('Are you sure you want to delete this deck? All cards will be deleted.')) {
    await deleteTopic(editingTopicId);
    deckModal.classList.add('hidden');
    if (currentTopicId === editingTopicId) {
      currentTopicId = null;
      cards = [];
      index = 0;
    }
    await load();
  }
};

function editDeck(topicId) {
  editingTopicId = topicId;
  modalTitle.textContent = 'Edit Deck';
  deleteDeckBtn.classList.remove('hidden');
  (async () => {
    const topics = await listTopics();
    const topic = topics.find(t => t.id === topicId);
    if (topic) {
      deckNameInput.value = topic.name;
      deckDescInput.value = topic.description || '';
      deckModal.classList.remove('hidden');
      deckNameInput.focus();
    }
  })();
}

function deleteDeckConfirm(topicId) {
  if (confirm('Are you sure you want to delete this deck? All cards will be deleted.')) {
    (async () => {
      await deleteTopic(topicId);
      if (currentTopicId === topicId) {
        currentTopicId = null;
        cards = [];
        index = 0;
      }
      await load();
    })();
  }
}

async function importToDeck(topicId) {
  const url = prompt('Enter Notion page URL to import:');
  if (!url || !url.trim()) return;
  
  try {
    const json = await fetchNotionPublicPage(url.trim());
    if (!json) {
      alert('Failed to import from Notion. Please check the URL.');
      return;
    }
    
    // Import only to this specific deck - assign all cards to this topic
    const cardsToImport = json.cards || [];
    
    if (cardsToImport.length === 0) {
      alert('No cards found to import.');
      return;
    }
    
    // Assign all cards to the target deck
    await addCardsToTopic(cardsToImport, topicId);
    
    // If we're currently viewing this deck, reload it
    if (currentTopicId === topicId) {
      await loadTopic(topicId);
    }
    await load(); // Refresh deck list
    alert(`Imported ${cardsToImport.length} cards to this deck.`);
  } catch (error) {
    console.error('Import error:', error);
    alert('Error importing from Notion. Please try again.');
  }
}

// Make functions available globally for inline onclick handlers
window.editDeck = editDeck;
window.deleteDeckConfirm = deleteDeckConfirm;
window.importToDeck = importToDeck;

studyAllMode.onchange = async (e) => {
  studyAllDecks = e.target.checked;
  if (studyAllDecks) {
    await loadAllDecks();
  } else if (currentTopicId) {
    await loadTopic(currentTopicId, false);
  } else {
    const items = await listTopics();
    if (items.length) {
      await loadTopic(items[0].id, false);
    }
  }
};

async function load() {
  const items = await listTopics();
  await renderTopics(items);
  // если есть хотя бы одна тема — сразу открываем первую и показываем карточку
  if (items.length && !studyAllDecks) {
    if (!currentTopicId || !items.find(t => t.id === currentTopicId)) {
      await loadTopic(items[0].id, true);
    } else {
      await loadTopic(currentTopicId, true);
    }
  } else if (studyAllDecks) {
    await loadAllDecks();
  } else {
    currentTopicId = null; cards = []; index = 0; await updateCardView();
  }
}

async function loadTopic(topicId, skipRefresh = false) {
  currentTopicId = topicId;
  studyAllDecks = false;
  cards = await listCardsByTopic(currentTopicId);
  // load SRS for cards into cache
  srsCache.clear();
  const records = await Promise.all(cards.map(c => getSrs(c.id)));
  records.forEach((rec, i) => { if (rec) srsCache.set(cards[i].id, rec); });
  // pick first card: prefer due
  index = pickNextIndex(cards, -1);
  await updateCardView();
  if (!skipRefresh) {
    // Refresh topic list to update active state (but don't reload the topic)
    const items = await listTopics();
    await renderTopics(items);
  }
}

async function loadAllDecks() {
  studyAllDecks = true;
  currentTopicId = null;
  const allCards = await getAllCards();
  const allSrs = await getAllSrs();
  
  // Build SRS cache
  srsCache.clear();
  allSrs.forEach(srs => srsCache.set(srs.cardId, srs));
  
  cards = allCards;
  index = pickNextIndex(cards, -1);
  await updateCardView();
  // Refresh topic list to update active state
  const items = await listTopics();
  await renderTopics(items);
}

function shuffle(arr) { arr.sort(() => Math.random() - 0.5); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

(async function init(){
  // Ensure modal is hidden on initialization
  if (deckModal) {
    deckModal.classList.add('hidden');
  }
  
  // Проверяем, есть ли уже данные в БД
  const existingTopics = await listTopics();
  
  // Если БД пустая - импортируем билеты с Notion (silently, no prompts)
  if (existingTopics.length === 0) {
    try {
      const data = await fetchNotionPublicPage(DEFAULT_NOTION_URL);
      if (data) await importJson(data);
    } catch (error) {
      console.log('Ошибка импорта из Notion:', error);
    }
  }
  
  await load();
})();

// Импорт публичной страницы Notion: если есть подстраницы — каждая становится отдельной темой (билетом)
async function fetchNotionPublicPage(publicUrl){
  const root = await fetchWithCorsFallback(publicUrl);
  if (!root) return null;
  if (root.includes('<html')) {
    const doc = new DOMParser().parseFromString(root, 'text/html');
    const childLinks = extractChildPageLinks(doc, publicUrl);
    if (childLinks.length) {
      const topics = [];
      const cards = [];
      for (const href of childLinks) {
        const html = await fetchWithCorsFallback(href);
        if (!html) continue;
        const { topic, pageCards } = parsePageToTopicAndCards(html);
        if (!topic) continue;
        topics.push(topic);
        pageCards.forEach(c => cards.push({ ...c, topic_id: topic.id }));
      }
      if (topics.length) return { topics, cards };
    }
    // Фоллбек: парсим корневую страницу как одну тему
    const { topic, pageCards } = parsePageToTopicAndCards(root);
    if (topic) return { topics: [topic], cards: pageCards.map(c => ({ ...c, topic_id: topic.id })) };
    return null;
  }
  // Текстовый ответ — парсим как одну тему
  const { topic, pageCards } = parsePageToTopicAndCards(root);
  if (topic) return { topics: [topic], cards: pageCards.map(c => ({ ...c, topic_id: topic.id })) };
  return null;
}

// Простая логика интервального повторения (SRS):
// Для каждой карточки храним уровень (n) и nextDue (ts).
// Если верно — n++, интервал = 2^n дней; если неверно — n=0, интервал = 1 день.
async function scheduleSrs(cardId, wasCorrect) {
  const now = Date.now();
  const record = (await getSrs(cardId)) || { cardId, level: 0, nextDue: now };
  if (wasCorrect) {
    record.level = Math.min(record.level + 1, 10);
  } else {
    record.level = 0;
  }
  const days = Math.max(1, Math.pow(2, record.level));
  record.nextDue = now + days * 24 * 60 * 60 * 1000;
  await upsertSrs(record);
  srsCache.set(cardId, { ...record });
}

// Выбор следующей карточки: приоритет карточкам с истёкшим nextDue
function pickNextIndex(all, currentIdx) {
  if (!all.length) return 0;
  const now = Date.now();
  const n = all.length;
  let minFutureDue = Number.POSITIVE_INFINITY;
  let minFutureIdx = (currentIdx + 1) % n;
  for (let step = 1; step <= n; step++) {
    const idx = (currentIdx + step) % n;
    const c = all[idx];
    const rec = srsCache.get(c.id);
    const due = rec?.nextDue ?? 0; // нет записи — считаем «должна» сейчас
    if (due <= now) return idx;
    if (due < minFutureDue) { minFutureDue = due; minFutureIdx = idx; }
  }
  return minFutureIdx;
}

function extractChildPageLinks(doc, baseUrl) {
  const base = new URL(baseUrl);
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  const urls = new Set();
  for (const a of anchors) {
    try {
      const u = new URL(a.getAttribute('href'), base);
      const isNotion = /notion\.(site|so)$/i.test(u.hostname);
      const hasId = /[a-f0-9]{32}/i.test(u.pathname);
      if (isNotion && hasId) urls.add(u.toString());
    } catch {}
  }
  return Array.from(urls);
}

function parsePageToTopicAndCards(content) {
  let title = 'Notion';
  const texts = [];
  
  if (content.includes('<html')) {
    const doc = new DOMParser().parseFromString(content, 'text/html');
    
    // Стратегия 1: Ищем в мета-тегах и title
    const metaTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                     doc.querySelector('meta[name="title"]')?.getAttribute('content') ||
                     doc.querySelector('title')?.textContent?.trim();
    
    if (metaTitle && metaTitle.length > 5) {
      title = metaTitle.replace(/^Notion\s*[-–—]\s*/i, '').trim();
    }
    
    // Стратегия 2: Ищем в заголовках страницы
    if (title === 'Notion') {
      const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const heading of headings) {
        const headingText = heading.textContent?.trim();
        if (headingText && headingText.length > 5 && /\d+/.test(headingText)) {
          title = headingText;
          break;
        }
      }
    }
    
    // Стратегия 3: Ищем в специальных Notion элементах
    if (title === 'Notion') {
      // Notion часто использует div с data-block-id для заголовков
      const notionBlocks = doc.querySelectorAll('[data-block-id]');
      for (const block of notionBlocks) {
        const blockText = block.textContent?.trim();
        if (blockText && blockText.length > 10 && /\d+\./.test(blockText)) {
          // Проверяем, что это похоже на заголовок билета
          if (blockText.includes('.') && 
              (blockText.includes('Теорема') || blockText.includes('Билет') || 
               blockText.includes('Вопрос') || blockText.includes('26') || 
               blockText.includes('27') || blockText.includes('28'))) {
            title = blockText;
            break;
          }
        }
      }
    }
    
    // Стратегия 4: Ищем в span элементах (Notion часто использует их для заголовков)
    if (title === 'Notion') {
      const spans = doc.querySelectorAll('span');
      for (const span of spans) {
        const spanText = span.textContent?.trim();
        if (spanText && spanText.length > 15 && /\d+\./.test(spanText)) {
          // Проверяем, что это похоже на полный заголовок билета
          if (spanText.includes('.') && spanText.length > 20) {
            title = spanText;
            break;
          }
        }
      }
    }
    
    // Стратегия 5: Ищем в любых элементах с текстом, содержащим номер билета
    if (title === 'Notion') {
      const allElements = doc.querySelectorAll('*');
      for (const el of allElements) {
        const elText = el.textContent?.trim();
        if (elText && elText.length > 20 && /\d+\./.test(elText)) {
          // Ищем текст, который содержит номер и описание
          if (elText.includes('.') && 
              (elText.includes('Теорема') || elText.includes('Билет') || 
               elText.includes('Вопрос') || elText.includes('26') || 
               elText.includes('27') || elText.includes('28'))) {
            title = elText;
            break;
          }
        }
      }
    }
    
    // Извлекаем контент для карточек
    const main = doc.querySelector('main') || doc.body;
    const elements = Array.from(main.querySelectorAll('h1, h2, h3, p, li, blockquote, pre, code, div'));
    for (const el of elements) {
      const txt = (el.textContent || '').trim();
      if (txt && txt.length > 3) texts.push(txt);
    }
  } else {
    // Для текстового контента
    const lines = content.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
    
    // Ищем строку с номером билета как заголовок
    for (const line of lines) {
      if (line.length > 20 && /\d+\./.test(line)) {
        if (line.includes('.') && 
            (line.includes('Теорема') || line.includes('Билет') || 
             line.includes('Вопрос') || line.includes('26') || 
             line.includes('27') || line.includes('28'))) {
          title = line;
          break;
        }
      }
    }
    
    texts.push(...lines);
  }
  
  // Убираем дубликаты и слишком короткие элементы
  const cleaned = [];
  for (const t of texts) {
    if (!t || t.length < 3) continue;
    if (cleaned.length && cleaned[cleaned.length - 1] === t) continue;
    cleaned.push(t);
  }
  
  const topicId = crypto.randomUUID();
  const pageCards = cleaned.map(t => ({ id: crypto.randomUUID(), question: t, answer: '' }));
  return { topic: { id: topicId, name: title, description: 'Импортировано из Notion' }, pageCards };
}

// CORS fallback: пробуем прямой доступ, затем r.jina.ai и allorigins.win
async function fetchWithCorsFallback(url){
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (r.ok) return await r.text();
  } catch {}
  try {
    const r2 = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//,'')}`);
    if (r2.ok) return await r2.text();
  } catch {}
  try {
    const enc = encodeURIComponent(url);
    const r3 = await fetch(`https://api.allorigins.win/raw?url=${enc}`);
    if (r3.ok) return await r3.text();
  } catch {}
  return null;
}


