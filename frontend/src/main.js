import './style.css';
import * as monaco from 'monaco-editor';
import { marked } from 'marked';
import { fetchFrameworkChallenges, fetchChallengeDetails } from './api.js';

// Worker setup for Monaco
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new jsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  }
};

let editor;
let currentChallengeData = null;
let currentFile = null;
let openTabs = [];
const fileModels = new Map();

const frameworks = [
  { id: 'django', name: 'Django', desc: 'Python web framework for perfectionists with deadlines.', logo: '🐍' },
  { id: 'express', name: 'Express.js', desc: 'Fast, unopinionated, minimalist web framework for Node.js.', logo: '🚂' },
  { id: 'fastapi', name: 'FastAPI', desc: 'High performance, easy to learn, fast to code, ready for production.', logo: '⚡' },
  { id: 'flask', name: 'Flask', desc: 'A lightweight WSGI web application framework.', logo: '🌶️' }
];

let selectedFramework = null;
let allChallenges = [];

const API_BASE_URL = 'http://localhost:8000';

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggle-sidebar-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('file-sidebar');
      sidebar.classList.toggle('collapsed');
      toggleBtn.textContent = sidebar.classList.contains('collapsed') ? '»' : '«';
      setTimeout(() => editor.layout(), 300);
    });
  }

  // Initialize empty editor
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    theme: 'vs-dark',
    automaticLayout: true,
    readOnly: true,
    minimap: { enabled: false }
  });

  document.getElementById('btn-submit').addEventListener('click', submitChallenge);

  // Setup nav
  document.getElementById('nav-home').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
  });

  // Setup routing
  window.addEventListener('popstate', handleRoute);
  
  // Render frameworks
  renderFrameworks();

  // Initial route
  handleRoute();
});

function navigate(path) {
  history.pushState({}, "", path);
  handleRoute();
}

function handleRoute() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  
  if (pathParts.length >= 2) {
    // Show editor view
    document.getElementById('homepage-view').style.display = 'none';
    document.getElementById('editor-view').style.display = 'flex';
    // wait for DOM to update then layout
    setTimeout(() => editor.layout(), 50);
    
    loadChallenge(pathParts[0], pathParts[1]);
  } else {
    // Show homepage view
    document.getElementById('homepage-view').style.display = 'flex';
    document.getElementById('editor-view').style.display = 'none';
    
    if (pathParts.length === 1 && frameworks.find(f => f.id === pathParts[0])) {
      selectFramework(pathParts[0]);
    }
  }
}

function renderFrameworks() {
  const grid = document.getElementById('framework-grid');
  if (!grid) return;
  grid.innerHTML = '';
  
  frameworks.forEach(fw => {
    const card = document.createElement('div');
    card.className = 'framework-card';
    card.id = `fw-card-${fw.id}`;
    card.onclick = () => {
      navigate(`/${fw.id}`);
      selectFramework(fw.id);
    };
    
    card.innerHTML = `
      <div class="framework-header">
        <div class="framework-name">${fw.logo} ${fw.name}</div>
      </div>
      <div class="framework-desc">${fw.desc}</div>
      <div class="framework-meta">
        <span>0 problems</span>
        <span>0% solved</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: 0%"></div>
      </div>
      <div class="view-problems-btn">View Problems</div>
    `;
    grid.appendChild(card);
  });
}

async function selectFramework(frameworkId) {
  selectedFramework = frameworkId;
  
  // Update UI active state
  document.querySelectorAll('.framework-card').forEach(c => c.classList.remove('active'));
  const cardElement = document.getElementById(`fw-card-${frameworkId}`);
  if (cardElement) {
    cardElement.classList.add('active');
  }
  
  document.getElementById('empty-state').style.display = 'none';
  const content = document.getElementById('problems-content');
  content.style.display = 'block';
  
  const fwInfo = frameworks.find(f => f.id === frameworkId);
  document.getElementById('problems-framework-title').textContent = `${fwInfo.name} Problems`;
  document.getElementById('problems-count').textContent = 'Loading...';
  document.getElementById('problems-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center">Loading...</td></tr>';
  
  try {
    allChallenges = await fetchFrameworkChallenges(frameworkId);
    
    // Update card meta mock
    const card = document.getElementById(`fw-card-${frameworkId}`);
    if (card) {
       const meta = card.querySelector('.framework-meta');
       const totalCount = allChallenges.length;
       const solvedCount = Math.floor(totalCount * 0.3); // Mock
       if (meta) {
         meta.innerHTML = `<span>${totalCount} problems</span><span>${totalCount > 0 ? Math.round((solvedCount/totalCount)*100) : 0}% solved</span>`;
       }
       const bar = card.querySelector('.progress-bar-fill');
       if (bar) bar.style.width = `${totalCount > 0 ? (solvedCount/totalCount)*100 : 0}%`;
    }
    
    document.getElementById('problems-count').textContent = `${allChallenges.length} problems`;
    renderProblemsTable();
  } catch(e) {
    document.getElementById('problems-tbody').innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--cf-red)">Error: ${e.message}</td></tr>`;
  }
}

function renderProblemsTable() {
  const tbody = document.getElementById('problems-tbody');
  tbody.innerHTML = '';
  
  if (allChallenges.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center">No problems available.</td></tr>`;
    return;
  }
  
  allChallenges.forEach((challenge, index) => {
    // Mock status and difficulty
    const isSolved = index % 3 === 0;
    const isAttempted = index % 3 === 1;
    const statusClass = isSolved ? 'status-solved' : (isAttempted ? 'status-attempted' : 'status-unsolved');
    const statusIcon = isSolved ? '✓' : (isAttempted ? '◐' : '○');
    
    const difficultyList = ['easy', 'medium', 'hard'];
    const difficultyText = ['Easy', 'Medium', 'Hard'];
    const diffIdx = index % 3;
    const diffClass = difficultyList[diffIdx];
    const diffText = difficultyText[diffIdx];
    
    const acceptance = Math.floor(Math.random() * 60) + 20; // 20% to 80%

    const tr = document.createElement('tr');
    tr.onclick = () => navigate(`/${selectedFramework}/${challenge.question_id}`);
    
    tr.innerHTML = `
      <td style="text-align: center"><span class="status-icon ${statusClass}">${statusIcon}</span></td>
      <td>
        <div style="font-weight: bold; color: var(--cf-blue); margin-bottom: 4px;">${challenge.title}</div>
        <div style="font-size: 12px; color: var(--cf-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 400px;">${challenge.description || ''}</div>
      </td>
      <td><span class="difficulty-badge ${diffClass}">${diffText}</span></td>
      <td>${acceptance}%</td>
      <td style="text-align: right">
        <button class="btn-solve">Solve</button>
      </td>
    `;
    
    tbody.appendChild(tr);
  });
}

async function loadChallenge(framework, challengeId) {
  const statusContainer = document.getElementById('status-container');
  
  if (!framework || !challengeId) return;

  statusContainer.textContent = 'Loading challenge...';

  try {
    const data = await fetchChallengeDetails(framework, challengeId);
    currentChallengeData = data;
    currentChallengeData.framework = framework;
    currentChallengeData.challengeId = challengeId;
    
    renderChallenge();
    document.getElementById('btn-submit').disabled = false;
    statusContainer.textContent = '';
  } catch (error) {
    statusContainer.innerHTML = `<span style="color: #ef4444">${error.message}</span>`;
  }
}

function renderChallenge() {
  if (!currentChallengeData) return;

  document.getElementById('challenge-title').textContent = currentChallengeData.title;
  document.getElementById('challenge-description').innerHTML = marked.parse(currentChallengeData.description);

  const tabsContainer = document.getElementById('tabs-container');
  tabsContainer.innerHTML = '';
  openTabs = [];
  
  const fileListContainer = document.getElementById('file-list');
  if (fileListContainer) fileListContainer.innerHTML = '';
  
  // Clear old models
  fileModels.forEach(model => model.dispose());
  fileModels.clear();

  const files = Object.keys(currentChallengeData.files).sort((a,b) => {
    // Sort editable files to front
    const aEd = currentChallengeData.editable_files.includes(a);
    const bEd = currentChallengeData.editable_files.includes(b);
    if (aEd && !bEd) return -1;
    if (!aEd && bEd) return 1;
    return a.localeCompare(b);
  });

  files.forEach((filename, index) => {
    const isEditable = currentChallengeData.editable_files.includes(filename);
    
    // Create monaco model
    let language = 'plaintext';
    if (filename.endsWith('.js') || filename.endsWith('.jsx')) language = 'javascript';
    else if (filename.endsWith('.ts') || filename.endsWith('.tsx')) language = 'typescript';
    else if (filename.endsWith('.css')) language = 'css';
    else if (filename.endsWith('.html')) language = 'html';
    else if (filename.endsWith('.json')) language = 'json';
    else if (filename.endsWith('.py')) language = 'python';

    const model = monaco.editor.createModel(
      currentChallengeData.files[filename],
      language
    );
    fileModels.set(filename, model);

    // Create sidebar item UI
    if (fileListContainer) {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';
      fileItem.innerHTML = `📄 ${filename} ${!isEditable ? '<span class="lock-icon" style="margin-left:auto">🔒</span>' : ''}`;
      fileItem.onclick = () => selectFile(filename);
      fileItem.dataset.filename = filename;
      fileListContainer.appendChild(fileItem);
    }
  });

  if (files.length > 0) {
    selectFile(files[0]);
  }
}

function renderTabs() {
  const tabsContainer = document.getElementById('tabs-container');
  tabsContainer.innerHTML = '';
  
  openTabs.forEach(filename => {
    const isEditable = currentChallengeData.editable_files.includes(filename);
    
    const tab = document.createElement('div');
    tab.className = 'tab';
    if (filename === currentFile) tab.classList.add('active');
    tab.dataset.filename = filename;
    
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.innerHTML = `${filename} ${!isEditable ? '<span class="lock-icon">🔒</span>' : ''}`;
    label.onclick = () => selectFile(filename);
    
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeTab(filename);
    };
    
    tab.appendChild(label);
    tab.appendChild(closeBtn);
    tabsContainer.appendChild(tab);
  });
  
  updateActiveStyles();
}

function closeTab(filename) {
  openTabs = openTabs.filter(f => f !== filename);
  
  if (currentFile === filename) {
    if (openTabs.length > 0) {
      selectFile(openTabs[openTabs.length - 1]);
    } else {
      currentFile = null;
      editor.setModel(null);
      renderTabs();
    }
  } else {
    renderTabs();
  }
}

function selectFile(filename) {
  currentFile = filename;
  
  if (!openTabs.includes(filename)) {
    openTabs.push(filename);
    renderTabs();
  } else {
    updateActiveStyles();
  }

  const model = fileModels.get(filename);
  if (model) {
    editor.setModel(model);
    const isEditable = currentChallengeData.editable_files.includes(filename);
    editor.updateOptions({ readOnly: !isEditable });
  }
}

function updateActiveStyles() {
  // Update active tab styles
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.filename === currentFile) t.classList.add('active');
    else t.classList.remove('active');
  });

  // Update active sidebar item styles
  document.querySelectorAll('.file-item').forEach(f => {
    if (f.dataset.filename === currentFile) f.classList.add('active');
    else f.classList.remove('active');
  });
}

async function submitChallenge() {
  if (!currentChallengeData) return;
  
  const btn = document.getElementById('btn-submit');
  const statusContainer = document.getElementById('status-container');
  
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  statusContainer.innerHTML = '<span style="color: var(--accent-color)">Submitting to server...</span>';

  // Gather editable files content
  const filesToSubmit = [];
  currentChallengeData.editable_files.forEach(filename => {
    if (fileModels.has(filename)) {
      filesToSubmit.push({
        filename: filename,
        content: fileModels.get(filename).getValue()
      });
    }
  });

  const payload = {
    idempotency_key: crypto.randomUUID(),
    framework: currentChallengeData.framework,
    challenge_id: parseInt(currentChallengeData.challengeId),
    base_ref: 'main',
    files: filesToSubmit
  };

  try {
    const response = await fetch(`${API_BASE_URL}/ticket/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.detail || 'Submission failed');
    }

    const result = await response.json();
    const jobId = result.job_id;
    
    pollStatus(jobId);
  } catch (error) {
    statusContainer.innerHTML = `<span style="color: #ef4444">Error: ${error.message}</span>`;
    btn.disabled = false;
    btn.textContent = 'Submit Challenge';
  }
}

async function pollStatus(jobId) {
  const statusContainer = document.getElementById('status-container');
  const btn = document.getElementById('btn-submit');
  
  let attempts = 0;
  const maxAttempts = 60; // 60 seconds

  const interval = setInterval(async () => {
    attempts++;
    try {
      const response = await fetch(`${API_BASE_URL}/ticket/status/${jobId}`);
      if (!response.ok) throw new Error('Failed to fetch status');
      
      const data = await response.json();
      
      if (data.status === 'finished') {
        clearInterval(interval);
        btn.disabled = false;
        btn.textContent = 'Submit Challenge';
        
        if (data.result && data.result.exit_code === 0) {
          statusContainer.innerHTML = `<span style="color: var(--success-color)">All Test Passed</span>`;
        } else {
          statusContainer.innerHTML = `<span style="color: #ef4444">Nope Try Again</span>`;
        }
      } else if (data.status === 'failed') {
        clearInterval(interval);
        btn.disabled = false;
        btn.textContent = 'Submit Challenge';
        statusContainer.innerHTML = `<span style="color: #ef4444">Submission failed</span>`;
      } else {
        statusContainer.innerHTML = `<span style="color: var(--accent-color)">Processing... (${attempts}s)</span>`;
      }
    } catch (e) {
      clearInterval(interval);
      btn.disabled = false;
      btn.textContent = 'Submit Challenge';
      statusContainer.innerHTML = `<span style="color: #ef4444">Error polling status</span>`;
    }

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      btn.disabled = false;
      btn.textContent = 'Submit Challenge';
      statusContainer.innerHTML = `<span style="color: #ef4444">Timeout polling status</span>`;
    }
  }, 1000);
}
