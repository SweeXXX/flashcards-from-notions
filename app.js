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

// GitHub sync elements
const githubSyncBtn = document.getElementById('githubSyncBtn');
const githubRestoreBtn = document.getElementById('githubRestoreBtn');
const githubModal = document.getElementById('githubModal');
const githubTokenInput = document.getElementById('githubTokenInput');
const githubRepoInput = document.getElementById('githubRepoInput');
const githubBranchInput = document.getElementById('githubBranchInput');
const testGithubBtn = document.getElementById('testGithubBtn');
const syncGithubBtn = document.getElementById('syncGithubBtn');
const saveGithubBtn = document.getElementById('saveGithubBtn');
const cancelGithubBtn = document.getElementById('cancelGithubBtn');
const githubStatus = document.getElementById('githubStatus');
const checkTokenBtn = document.getElementById('checkTokenBtn');
const importGithubBtn = document.getElementById('importGithubBtn');
console.log('GitHub elements found:', {
  githubStatus: !!githubStatus,
  checkTokenBtn: !!checkTokenBtn,
  importGithubBtn: !!importGithubBtn
});

let currentTopicId = localStorage.getItem('currentTopicId') || null;
let cards = [];
let index = 0;
let showEditor = true;
let studyAllDecks = localStorage.getItem('studyAllDecks') === 'true';
let editingTopicId = null;
const srsCache = new Map(); // cardId -> { cardId, level, nextDue }

// GitHub sync settings
let githubToken = localStorage.getItem('githubToken') || '';
let githubRepo = localStorage.getItem('githubRepo') || '';
let githubBranch = localStorage.getItem('githubBranch') || 'main';

// Backup settings for recovery
let githubSettingsBackup = JSON.parse(localStorage.getItem('githubSettingsBackup') || 'null');

// Function to check if GitHub settings are configured
function areGithubSettingsConfigured() {
  return githubToken && githubRepo;
}

// Function to validate GitHub token format
function validateGithubToken(token) {
  if (!token) return false;
  // GitHub tokens are typically 40 characters long and start with ghp_ (classic) or github_pat_ (fine-grained)
  return token.length >= 20; // Be flexible, but ensure it's not empty/short
}

// Function to check token format and provide feedback
function checkTokenFormat() {
  const token = githubTokenInput.value.trim();
  if (!token) {
    return 'No token entered';
  }
  if (token.length < 20) {
    return `Token too short (${token.length} chars). GitHub tokens are usually 40+ characters.`;
  }
  if (token.includes(' ')) {
    return 'Token contains spaces. Make sure you copied the entire token.';
  }
  return 'Token format looks OK';
}

// Function to update GitHub button states based on settings
function updateGithubButtonStates() {
  const isConfigured = areGithubSettingsConfigured();
  if (syncGithubBtn) {
    syncGithubBtn.disabled = !isConfigured;
    syncGithubBtn.title = isConfigured ? 'Sync data to GitHub' : 'Configure GitHub settings first';
  }
  if (testGithubBtn) {
    testGithubBtn.disabled = !isConfigured;
    testGithubBtn.title = isConfigured ? 'Test GitHub connection' : 'Configure GitHub settings first';
  }
  if (importGithubBtn) {
    importGithubBtn.disabled = !isConfigured;
    importGithubBtn.title = isConfigured ? 'Import data from GitHub' : 'Configure GitHub settings first';
  }
}

// Function to backup GitHub settings
function backupGithubSettings() {
  if (githubToken || githubRepo) {
    const settings = {
      token: githubToken,
      repo: githubRepo,
      branch: githubBranch,
      timestamp: Date.now()
    };
    localStorage.setItem('githubSettingsBackup', JSON.stringify(settings));
    githubSettingsBackup = settings;
  }
}

// Function to restore GitHub settings from backup
function restoreGithubSettings() {
  if (githubSettingsBackup && confirm('Найдены сохраненные настройки GitHub. Восстановить их?')) {
    githubToken = githubSettingsBackup.token;
    githubRepo = githubSettingsBackup.repo;
    githubBranch = githubSettingsBackup.branch;
    localStorage.setItem('githubToken', githubToken);
    localStorage.setItem('githubRepo', githubRepo);
    localStorage.setItem('githubBranch', githubBranch);

    // Update button states
    updateGithubButtonStates();

    // Hide restore button after successful restore
    if (githubRestoreBtn) {
      githubRestoreBtn.style.display = 'none';
    }

    alert('✅ Настройки GitHub восстановлены!');
    return true;
  }
  return false;
}

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
  await syncToGithubIfEnabled();
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
  await syncToGithubIfEnabled();
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
    await syncToGithubIfEnabled();
    if (currentTopicId === editingTopicId) {
      currentTopicId = null;
      localStorage.setItem('currentTopicId', '');
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
      await syncToGithubIfEnabled();
      if (currentTopicId === topicId) {
        currentTopicId = null;
        localStorage.setItem('currentTopicId', '');
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
    await syncToGithubIfEnabled();

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
  localStorage.setItem('studyAllDecks', studyAllDecks);
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

// GitHub sync event handlers
console.log('Setting up GitHub sync handlers...');
console.log('githubSyncBtn exists:', !!githubSyncBtn);
console.log('githubModal exists:', !!githubModal);
console.log('githubTokenInput exists:', !!githubTokenInput);

if (githubSyncBtn) {
  githubSyncBtn.onclick = () => {
    console.log('GitHub sync button clicked');
    console.log('githubToken:', githubToken);
    console.log('githubRepo:', githubRepo);
    console.log('githubBranch:', githubBranch);

    if (githubTokenInput) githubTokenInput.value = githubToken;
    if (githubRepoInput) githubRepoInput.value = githubRepo;
    if (githubBranchInput) githubBranchInput.value = githubBranch;
    if (githubStatus) githubStatus.textContent = '';

    githubModal.classList.remove('hidden');
    console.log('GitHub modal should be visible now');
  };
}

if (githubRestoreBtn) {
  githubRestoreBtn.onclick = () => {
    restoreGithubSettings();
  };
}

if (checkTokenBtn) {
  checkTokenBtn.onclick = () => {
    const result = checkTokenFormat();
    githubStatus.textContent = `Token check: ${result}`;
    githubStatus.style.color = result.includes('OK') ? '#4CAF50' : '#f44336';
  };
}

if (testGithubBtn) {
  testGithubBtn.onclick = async () => {
    console.log('Test GitHub button clicked');
    githubStatus.textContent = 'Testing connection...';
    try {
      const success = await testGithubConnection();
      if (success) {
        githubStatus.textContent = '✅ Connection successful!';
        githubStatus.style.color = '#4CAF50';
      } else {
        githubStatus.textContent = '❌ Connection failed. Check your settings.';
        githubStatus.style.color = '#f44336';
      }
    } catch (error) {
      console.error('Test connection error:', error);
      let errorMsg = error.message;

      // Provide more helpful error messages
      if (errorMsg.includes('404')) {
        errorMsg = 'Repository not found. Check the repository name and ensure it exists.';
      } else if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
        errorMsg = 'Invalid token or insufficient permissions. Check your Personal Access Token.';
      } else if (errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
        errorMsg = 'Access denied. Your token may not have the required permissions (repo scope needed).';
      } else if (errorMsg.includes('format')) {
        errorMsg = errorMsg; // Keep the validation message as-is
      }

      githubStatus.textContent = `❌ ${errorMsg}`;
      githubStatus.style.color = '#f44336';
    }
  };
}

if (syncGithubBtn) {
  syncGithubBtn.onclick = async () => {
    console.log('Sync GitHub button clicked');
    githubStatus.textContent = 'Syncing data...';
    try {
      await exportDataToGithub();
      githubStatus.textContent = '✅ Data exported to GitHub!';
      githubStatus.style.color = '#4CAF50';
    } catch (error) {
      console.error('Sync GitHub error:', error);
      const errorMsg = error.message.includes('not configured')
        ? 'Please configure your GitHub settings first (token and repository)'
        : error.message;
      githubStatus.textContent = `❌ Sync failed: ${errorMsg}`;
      githubStatus.style.color = '#f44336';
    }
  };
}

if (importGithubBtn) {
  console.log('Import GitHub button element found:', importGithubBtn);
  importGithubBtn.onclick = async () => {
    console.log('Import from GitHub button clicked - handler executed');
    if (!confirm('⚠️ This will REPLACE ALL your local data with data from GitHub.\n\nAre you sure you want to continue?')) {
      console.log('Import cancelled by user');
      return;
    }

    console.log('Starting import from GitHub');
    githubStatus.textContent = 'Importing data from GitHub...';
    try {
      console.log('Calling importDataFromGithub function');
      await importDataFromGithub();
      console.log('Import successful, refreshing UI');
      await load(); // Refresh the UI
      githubStatus.textContent = '✅ Data imported from GitHub successfully!';
      githubStatus.style.color = '#4CAF50';
    } catch (error) {
      console.error('Import from GitHub error:', error);
      const errorMsg = error.message.includes('not configured')
        ? 'Please configure your GitHub settings first (token and repository)'
        : error.message;
      githubStatus.textContent = `❌ Import failed: ${errorMsg}`;
      githubStatus.style.color = '#f44336';
    }
  };
}

if (saveGithubBtn) {
  saveGithubBtn.onclick = () => {
    console.log('Save GitHub button clicked');
    const newToken = githubTokenInput.value.trim();
    const newRepo = githubRepoInput.value.trim();
    const newBranch = githubBranchInput.value.trim() || 'main';

    // Validate token format
    if (newToken && !validateGithubToken(newToken)) {
      alert('GitHub token appears to be invalid.\n\nMake sure you:\n• Copied the ENTIRE token (it should be long)\n• Didn\'t accidentally copy the token name instead\n• The token hasn\'t expired\n\nGet a new token at: https://github.com/settings/tokens');
      githubTokenInput.focus();
      return;
    }

    // Validate repository format
    if (newRepo && !newRepo.includes('/')) {
      alert('Repository must be in format: username/repository\nExample: myusername/myrepo');
      githubRepoInput.focus();
      return;
    }

    const parts = newRepo.split('/');
    if (newRepo && (parts.length !== 2 || !parts[0] || !parts[1])) {
      alert('Repository must be in format: username/repository\nExample: myusername/myrepo');
      githubRepoInput.focus();
      return;
    }

    githubToken = newToken;
    githubRepo = newRepo;
    githubBranch = newBranch;

    localStorage.setItem('githubToken', githubToken);
    localStorage.setItem('githubRepo', githubRepo);
    localStorage.setItem('githubBranch', githubBranch);

    // Backup settings for recovery
    backupGithubSettings();

    // Update button states
    updateGithubButtonStates();

    githubModal.classList.add('hidden');
  };
}

if (cancelGithubBtn) {
  cancelGithubBtn.onclick = () => {
    console.log('GitHub cancel button clicked');
    githubModal.classList.add('hidden');
  };
}

// Close modal when clicking outside
if (githubModal) {
  githubModal.onclick = (e) => {
    console.log('GitHub modal background clicked');
    if (e.target === githubModal) {
      console.log('Closing GitHub modal');
      githubModal.classList.add('hidden');
    }
  };
}

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
  localStorage.setItem('currentTopicId', currentTopicId);
  localStorage.setItem('studyAllDecks', studyAllDecks);
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
  localStorage.setItem('currentTopicId', currentTopicId || '');
  localStorage.setItem('studyAllDecks', studyAllDecks);
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

// GitHub API functions
async function githubRequest(endpoint, options = {}) {
  if (!githubToken || !githubRepo) {
    throw new Error('GitHub settings not configured');
  }

  const url = `https://api.github.com/repos/${githubRepo}${endpoint}`;
  const headers = {
    'Authorization': `token ${githubToken}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    ...options.headers
  };

  console.log('GitHub API Request:', {
    url: url,
    method: options.method || 'GET',
    hasToken: !!githubToken,
    tokenLength: githubToken ? githubToken.length : 0,
    repo: githubRepo
  });

  const response = await fetch(url, { ...options, headers });

  console.log('GitHub API Response:', {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error('GitHub API Error Details:', {
      status: response.status,
      statusText: response.statusText,
      responseBody: errorText
    });
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getFileFromGithub(path) {
  try {
    const data = await githubRequest(`/contents/${path}?ref=${githubBranch}`);
    return JSON.parse(atob(data.content));
  } catch (error) {
    if (error.message.includes('404')) {
      return null; // File doesn't exist
    }
    throw error;
  }
}

async function saveFileToGithub(path, content, message = 'Update flashcards data') {
  const jsonContent = JSON.stringify(content, null, 2);
  const encodedContent = btoa(unescape(encodeURIComponent(jsonContent)));

  // Try to get existing file for SHA
  let sha = null;
  try {
    const existingFile = await githubRequest(`/contents/${path}?ref=${githubBranch}`);
    sha = existingFile.sha;
  } catch (error) {
    // File doesn't exist, that's fine
  }

  const body = {
    message,
    content: encodedContent,
    branch: githubBranch,
    ...(sha && { sha })
  };

  return githubRequest(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

async function testGithubConnection() {
  try {
    // First validate the repository format
    if (!githubRepo || !githubRepo.includes('/')) {
      throw new Error('Repository must be in format: username/repository');
    }

    const parts = githubRepo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error('Repository must be in format: username/repository');
    }

    // Test the connection by getting repository contents
    await githubRequest('/contents');
    return true;
  } catch (error) {
    console.error('GitHub connection test failed:', error);
    throw error; // Re-throw to preserve the original error message
  }
}

async function exportDataToGithub() {
  const topics = await listTopics();
  const cards = await getAllCards();
  const srs = await getAllSrs();

  const data = {
    topics,
    cards,
    srs,
    exportedAt: new Date().toISOString()
  };

  await saveFileToGithub('flashcards-data.json', data, 'Export flashcards data');
  return data;
}

async function importDataFromGithub() {
  console.log('importDataFromGithub function called');
  console.log('Fetching flashcards-data.json from GitHub...');
  const data = await getFileFromGithub('flashcards-data.json');
  console.log('Data received from GitHub:', data);

  if (!data) {
    console.error('No data found on GitHub');
    throw new Error('No data found on GitHub');
  }

  console.log('Clearing local data...');
  // Import data to local database
  await clearAll();
  console.log('Importing data to local database...');
  await importJson(data);
  console.log('Import completed successfully');

  return data;
}

// Auto-sync to GitHub if configured
async function syncToGithubIfEnabled() {
  if (!githubToken || !githubRepo) {
    return; // GitHub not configured
  }

  try {
    await exportDataToGithub();
    console.log('✅ Auto-synced to GitHub');
  } catch (error) {
    console.error('❌ Auto-sync to GitHub failed:', error);
    // Don't show alert for auto-sync failures to avoid interrupting user
  }
}

function shuffle(arr) { arr.sort(() => Math.random() - 0.5); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

(async function init(){
  console.log('Initializing app...');
  console.log('DOM elements check:');
  console.log('- githubSyncBtn:', !!document.getElementById('githubSyncBtn'));
  console.log('- githubModal:', !!document.getElementById('githubModal'));
  console.log('- githubTokenInput:', !!document.getElementById('githubTokenInput'));
  console.log('- cancelGithubBtn:', !!document.getElementById('cancelGithubBtn'));

  // Ensure modal is hidden on initialization
  if (deckModal) {
    deckModal.classList.add('hidden');
  }

  // Set study mode checkbox to match saved value
  if (studyAllMode) {
    studyAllMode.checked = studyAllDecks;
  }

  // Show restore button if backup exists but current settings are empty
  if (githubSettingsBackup && (!githubToken || !githubRepo) && githubRestoreBtn) {
    githubRestoreBtn.style.display = 'inline-block';
  }

  // Update GitHub button states based on current settings
  updateGithubButtonStates();

  // Проверяем, есть ли уже данные в БД
  const existingTopics = await listTopics();

  // БД остается пустой при первом запуске - пользователь должен создать колоды вручную

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
  await syncToGithubIfEnabled();
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


