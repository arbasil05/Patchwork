import React from 'react';

function Header() {
  return (
    <div id="cf-header">
      <div className="header-left">
        <div className="logo-container">
          <span className="logo-text">PATCHWORK</span>
        </div>
      </div>
      <div className="header-right">
        <div className="user-info">
          <span className="user-rank-pupil">arbasil05</span> | <a href="#" className="cf-link">Logout</a>
        </div>
      </div>
    </div>
  );
}

export default Header;
