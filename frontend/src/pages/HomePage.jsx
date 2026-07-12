import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchFrameworkChallenges } from '../api.js';

const frameworks = [
  { id: 'django', name: 'Django', desc: 'Python web framework for perfectionists with deadlines.', logo: '🐍' },
  { id: 'express', name: 'Express.js', desc: 'Fast, unopinionated, minimalist web framework for Node.js.', logo: '🚂' },
  { id: 'fastapi', name: 'FastAPI', desc: 'High performance, easy to learn, fast to code, ready for production.', logo: '⚡' },
  { id: 'flask', name: 'Flask', desc: 'A lightweight WSGI web application framework.', logo: '🌶️' }
];

function HomePage() {
  const { framework } = useParams();
  const navigate = useNavigate();
  
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (framework) {
      loadFramework(framework);
    } else {
      setChallenges([]);
    }
  }, [framework]);

  const loadFramework = async (fwId) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFrameworkChallenges(fwId);
      setChallenges(data);
    } catch (e) {
      setError(e.message);
      setChallenges([]);
    } finally {
      setLoading(false);
    }
  };

  const selectedFwInfo = frameworks.find(f => f.id === framework);
  
  // Calculate mock progress
  const totalCount = challenges.length;
  const solvedCount = Math.floor(totalCount * 0.3);
  const progressPercent = totalCount > 0 ? (solvedCount/totalCount)*100 : 0;

  return (
    <div id="homepage-view" className="homepage-container">
      <div className="homepage-section">
        <h2 className="section-title">Available Stacks</h2>
        <p className="section-subtitle">Select a framework to browse debugging challenges.</p>
        
        <div className="framework-grid" id="framework-grid">
          {frameworks.map(fw => {
            const isActive = fw.id === framework;
            return (
              <div 
                key={fw.id}
                className={`framework-card ${isActive ? 'active' : ''}`}
                onClick={() => navigate(`/${fw.id}`)}
              >
                <div className="framework-header">
                  <div className="framework-name">{fw.logo} {fw.name}</div>
                </div>
                <div className="framework-desc">{fw.desc}</div>
                {isActive && !loading && !error && (
                  <>
                    <div className="framework-meta">
                      <span>{totalCount} problems</span>
                      <span>{Math.round(progressPercent)}% solved</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }}></div>
                    </div>
                  </>
                )}
                <div className="view-problems-btn">View Problems</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="homepage-section problems-section" id="problems-section">
        {!framework ? (
          <div className="empty-state" id="empty-state">
            <h3>Choose a Stack</h3>
            <p>Select a framework above to browse real-world debugging challenges and start solving.</p>
            <div className="empty-illustration">{`{ }`}</div>
          </div>
        ) : (
          <div id="problems-content">
            <div className="problems-header">
              <h3 id="problems-framework-title">{selectedFwInfo?.name} Problems</h3>
              <span id="problems-count">{loading ? 'Loading...' : `${challenges.length} problems`}</span>
            </div>
            
            <div className="problems-toolbar">
              <input type="text" id="problem-search" placeholder="Search problems..." />
              <select id="difficulty-filter" className="cf-select">
                <option value="All">All Difficulty</option>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
              <select id="status-filter" className="cf-select">
                <option value="All">All Status</option>
                <option value="Solved">Solved</option>
                <option value="Attempted">Attempted</option>
                <option value="Unsolved">Unsolved</option>
              </select>
            </div>

            <table className="cf-table">
              <thead>
                <tr>
                  <th style={{ width: '60px', textAlign: 'center' }}>Status</th>
                  <th>Problem</th>
                  <th style={{ width: '100px' }}>Difficulty</th>
                  <th style={{ width: '120px' }}>Acceptance</th>
                  <th style={{ width: '100px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody id="problems-tbody">
                {loading && (
                  <tr><td colSpan="5" style={{ textAlign: 'center' }}>Loading...</td></tr>
                )}
                {error && (
                  <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--cf-red)' }}>Error: {error}</td></tr>
                )}
                {!loading && !error && challenges.length === 0 && (
                  <tr><td colSpan="5" style={{ textAlign: 'center' }}>No problems available.</td></tr>
                )}
                {!loading && !error && challenges.map((challenge, index) => {
                  const isSolved = index % 3 === 0;
                  const isAttempted = index % 3 === 1;
                  const statusClass = isSolved ? 'status-solved' : (isAttempted ? 'status-attempted' : 'status-unsolved');
                  const statusIcon = isSolved ? '✓' : (isAttempted ? '◐' : '○');
                  
                  const difficultyList = ['easy', 'medium', 'hard'];
                  const difficultyText = ['Easy', 'Medium', 'Hard'];
                  const diffIdx = index % 3;
                  const diffClass = difficultyList[diffIdx];
                  const diffText = difficultyText[diffIdx];
                  
                  const acceptance = Math.floor(Math.random() * 60) + 20;

                  return (
                    <tr key={challenge.question_id} onClick={() => navigate(`/${framework}/${challenge.question_id}`)}>
                      <td style={{ textAlign: 'center' }}><span className={`status-icon ${statusClass}`}>{statusIcon}</span></td>
                      <td>
                        <div style={{ fontWeight: 'bold', color: 'var(--cf-blue)', marginBottom: '4px' }}>{challenge.title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--cf-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px' }}>{challenge.description || ''}</div>
                      </td>
                      <td><span className={`difficulty-badge ${diffClass}`}>{diffText}</span></td>
                      <td>{acceptance}%</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn-solve">Solve</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default HomePage;
