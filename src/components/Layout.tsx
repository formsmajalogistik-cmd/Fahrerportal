import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { instance, accounts } = useMsal();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const user = accounts[0];

  const handleLogout = async () => {
    await instance.logoutPopup();
    navigate('/');
  };

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/fahrer', label: 'Fahrer', icon: '🚛' },
    { path: '/formulare', label: 'Formulare', icon: '📋' },
    { path: '/zuweisungen', label: 'Zuweisungen', icon: '📌' },
    { path: '/offen', label: 'Offene Formulare', icon: '📂' },
  ];

  return (
    <div className="layout">
      <header className="header">
        <div className="header-left">
          <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
            ☰
          </button>
          <Link to="/dashboard" className="logo">
            <span className="logo-text">Maja Logistik</span>
            <span className="logo-sub">Fahrerportal</span>
          </Link>
        </div>
        {user && (
          <div className="header-right">
            <span className="user-name">{user.name || user.username}</span>
            <button className="btn-logout" onClick={handleLogout}>
              Abmelden
            </button>
          </div>
        )}
      </header>

      <div className="main-wrapper">
        <nav className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <ul className="nav-list">
            {navItems.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} />}

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
