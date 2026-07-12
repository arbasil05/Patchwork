import React from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import Header from './components/Header.jsx';
import HomePage from './pages/HomePage.jsx';
import EditorPage from './pages/EditorPage.jsx';

function App() {
  return (
    <div id="cf-page-wrapper">
      <Header />

      <div id="cf-nav">
        <ul className="nav-links">
          <li className="active"><Link to="/" id="nav-home">HOME</Link></li>
        </ul>
      </div>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/:framework" element={<HomePage />} />
        <Route path="/:framework/:challengeId" element={<EditorPage />} />
      </Routes>

      <div className="cf-footer">
        <div className="footer-left">© 2026 Patchwork</div>
        <div className="footer-right">Built with ❤️ for developers</div>
      </div>
    </div>
  );
}

export default App;
