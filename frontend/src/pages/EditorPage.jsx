import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import { fetchChallengeDetails } from '../api.js';
import MonacoEditor from '../components/MonacoEditor.jsx';
import * as monaco from 'monaco-editor';
import { v4 as uuidv4 } from "uuid";
const API_BASE_URL = 'http://13.127.255.138:8000';

function EditorPage() {
  const { framework, challengeId } = useParams();
  const navigate = useNavigate();
  
  const [challengeData, setChallengeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState({ text: 'Loading challenge...', type: 'info' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [openTabs, setOpenTabs] = useState([]);
  const [currentFile, setCurrentFile] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Keep models outside of state to prevent re-renders on every model change
  const fileModelsRef = useRef(new Map());

  useEffect(() => {
    loadChallenge();
    return () => {
      fileModelsRef.current.forEach(model => model.dispose());
      fileModelsRef.current.clear();
    };
  }, [framework, challengeId]);

  const loadChallenge = async () => {
    setLoading(true);
    setStatusMsg({ text: 'Loading challenge...', type: 'info' });
    try {
      const data = await fetchChallengeDetails(framework, challengeId);
      
      // Setup file models
      fileModelsRef.current.forEach(model => model.dispose());
      fileModelsRef.current.clear();
      
      const files = Object.keys(data.files).filter(f => f !== 'production.log' && !f.includes('test')).sort((a,b) => {
        const aEd = data.editable_files.includes(a);
        const bEd = data.editable_files.includes(b);
        if (aEd && !bEd) return -1;
        if (!aEd && bEd) return 1;
        return a.localeCompare(b);
      });

      files.forEach(filename => {
        let language = 'plaintext';
        if (filename.endsWith('.js') || filename.endsWith('.jsx')) language = 'javascript';
        else if (filename.endsWith('.ts') || filename.endsWith('.tsx')) language = 'typescript';
        else if (filename.endsWith('.css')) language = 'css';
        else if (filename.endsWith('.html')) language = 'html';
        else if (filename.endsWith('.json')) language = 'json';
        else if (filename.endsWith('.py')) language = 'python';

        const model = monaco.editor.createModel(data.files[filename], language);
        fileModelsRef.current.set(filename, model);
      });
      
      data.sortedFiles = files;
      setChallengeData(data);
      
      if (files.length > 0) {
        selectFile(files[0], [files[0]]);
      }
      
      setStatusMsg(null);
    } catch (err) {
      setError(err.message);
      setStatusMsg({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const selectFile = (filename, currentTabs = openTabs) => {
    setCurrentFile(filename);
    if (!currentTabs.includes(filename)) {
      setOpenTabs([...currentTabs, filename]);
    } else {
      setOpenTabs([...currentTabs]);
    }
  };

  const closeTab = (e, filename) => {
    e.stopPropagation();
    const newTabs = openTabs.filter(f => f !== filename);
    setOpenTabs(newTabs);
    
    if (currentFile === filename) {
      if (newTabs.length > 0) {
        setCurrentFile(newTabs[newTabs.length - 1]);
      } else {
        setCurrentFile(null);
      }
    }
  };

  const submitChallenge = async () => {
    if (!challengeData) return;
    
    setIsSubmitting(true);
    setStatusMsg({ text: 'Submitting to server...', type: 'info' });

    const filesToSubmit = [];
    challengeData.editable_files.forEach(filename => {
      if (fileModelsRef.current.has(filename)) {
        filesToSubmit.push({
          filename: filename,
          content: fileModelsRef.current.get(filename).getValue()
        });
      }
    });

    const payload = {
      idempotency_key: uuidv4(),
      framework: framework,
      challenge_id: parseInt(challengeId),
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
      pollStatus(result.job_id);
    } catch (error) {
      setStatusMsg({ text: `Error: ${error.message}`, type: 'error' });
      setIsSubmitting(false);
    }
  };

  const pollStatus = (jobId) => {
    let attempts = 0;
    const maxAttempts = 60;
    
    const interval = setInterval(async () => {
      attempts++;
      try {
        const response = await fetch(`${API_BASE_URL}/ticket/status/${jobId}`);
        if (!response.ok) throw new Error('Failed to fetch status');
        
        const data = await response.json();
        
        if (data.status === 'finished') {
          clearInterval(interval);
          setIsSubmitting(false);
          
          if (data.result && data.result.exit_code === 0) {
            setStatusMsg({ text: 'All Test Passed', type: 'success' });
          } else {
            setStatusMsg({ text: 'Nope Try Again', type: 'error' });
          }
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setIsSubmitting(false);
          setStatusMsg({ text: 'Submission failed', type: 'error' });
        } else {
          setStatusMsg({ text: `Processing... (${attempts}s)`, type: 'info' });
        }
      } catch (e) {
        clearInterval(interval);
        setIsSubmitting(false);
        setStatusMsg({ text: 'Error polling status', type: 'error' });
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        setIsSubmitting(false);
        setStatusMsg({ text: 'Timeout polling status', type: 'error' });
      }
    }, 1000);
  };

  const isCurrentFileEditable = challengeData?.editable_files.includes(currentFile);

  return (
    <div id="editor-view" style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%', flexDirection: 'column' }}>
      <div id="app" className="cf-container">
        <div id="left-panel">
          {challengeData?.ticket && (
            <div className="cf-card ticket-container">
              <div className="cf-card-header">Ticket Information</div>
              <div className="cf-card-body">
                <div className="ticket-grid">
                  <div><strong>ID:</strong> {challengeData.ticket.id}</div>
                  <div><strong>Priority:</strong> {challengeData.ticket.priority}</div>
                  <div><strong>Status:</strong> {challengeData.ticket.status}</div>
                  <div><strong>Environment:</strong> {challengeData.ticket.environment}</div>
                  <div><strong>Reporter:</strong> {challengeData.ticket.reporter}</div>
                  <div><strong>Assignee:</strong> {challengeData.ticket.assignee}</div>
                </div>
                <div className="ticket-summary">
                  <strong>Summary:</strong> {challengeData.ticket.summary}
                </div>
                {challengeData.ticket.acceptance_criteria && (
                  <div className="ticket-criteria">
                    <strong>Acceptance Criteria:</strong>
                    <ul>
                      {challengeData.ticket.acceptance_criteria.map((criteria, idx) => (
                        <li key={idx}>{criteria}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="cf-card description-container">
            <div className="cf-card-header">Problem Statement</div>
            <div className="cf-card-body">
              {challengeData && (
                <div className="cf-problem-statement">
                  <div className="header">
                    <h1 id="challenge-title" className="title">{challengeData.title}</h1>
                    <div className="memory-limit">memory limit per test: 256 megabytes</div>
                    <div className="input-file">input: standard input</div>
                    <div className="output-file">output: standard output</div>
                  </div>
                  <div 
                    id="challenge-description" 
                    className="markdown-body"
                    dangerouslySetInnerHTML={{ __html: marked.parse(challengeData.description) }}
                  ></div>
                </div>
              )}
            </div>
          </div>

          <div className="cf-card terminal-container">
             <div className="cf-card-header terminal-header">Production Logs</div>
             <div className="cf-card-body terminal-body">
                {challengeData?.artifacts?.find(a => a.type === 'log')?.content || challengeData?.files['production.log'] || 'No logs available.'}
             </div>
          </div>

          <div className="cf-card action-container">
            <div className="cf-card-header">Submit Area</div>
            <div className="cf-card-body">
              <button 
                id="btn-submit" 
                className="cf-btn cf-btn-submit" 
                onClick={submitChallenge}
                disabled={loading || isSubmitting || !challengeData}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Challenge'}
              </button>
              <div id="status-container">
                {statusMsg && (
                  <span style={{ 
                    color: statusMsg.type === 'error' ? '#ef4444' : 
                           statusMsg.type === 'success' ? 'var(--cf-green)' : 'var(--cf-blue)' 
                  }}>
                    {statusMsg.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div id="right-panel">
          <div id="file-sidebar" className={sidebarCollapsed ? 'collapsed' : ''}>
            <div className="sidebar-header">
              <span className="sidebar-title">Files</span>
              <button id="toggle-sidebar-btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title="Toggle Sidebar">
                {sidebarCollapsed ? '»' : '«'}
              </button>
            </div>
            <div id="file-list">
              {challengeData?.sortedFiles.map(filename => {
                const isEditable = challengeData.editable_files.includes(filename);
                return (
                  <div 
                    key={filename}
                    className={`file-item ${currentFile === filename ? 'active' : ''}`}
                    onClick={() => selectFile(filename)}
                  >
                    📄 {filename} {!isEditable && <span className="lock-icon" style={{ marginLeft: 'auto' }}>🔒</span>}
                  </div>
                );
              })}
            </div>
          </div>
          <div id="editor-area">
            <div id="tabs-container">
              {openTabs.map(filename => {
                const isEditable = challengeData?.editable_files.includes(filename);
                return (
                  <div 
                    key={filename}
                    className={`tab ${currentFile === filename ? 'active' : ''}`}
                    onClick={() => selectFile(filename)}
                  >
                    <span className="tab-label">
                      {filename} {!isEditable && <span className="lock-icon">🔒</span>}
                    </span>
                    <span className="tab-close" onClick={(e) => closeTab(e, filename)}>×</span>
                  </div>
                );
              })}
            </div>
            <MonacoEditor 
              fileModels={fileModelsRef.current}
              currentFile={currentFile}
              isEditable={isCurrentFileEditable}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditorPage;
