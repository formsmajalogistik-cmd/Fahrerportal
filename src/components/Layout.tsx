import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navItems: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/formulare', label: 'Meine Formulare', icon: 'document' },
  ];

  const displayName = user ? `${user.vorname} ${user.name}`.trim() : '';

  return (
    <div className="layout">
      <header className="header">
        <div className="header-left">
          <button
            className="menu-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menü umschalten"
          >
            <Icon name="menu" size={22} />
          </button>
          <Link to="/dashboard" className="logo-link">
            <Logo variant="light" size={36} />
          </Link>
        </div>
        {user && (
          <div className="header-right">
            <span className="user-name">{displayName}</span>
            <button
              className="btn-logout"
              onClick={handleLogout}
              aria-label="Abmelden"
            >
              <Icon name="logout" size={16} />
              <span>Abmelden</span>
            </button>
          </div>
        )}
      </header>

      <div className="main-wrapper">
        <nav className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <ul className="nav-list">
            {navItems.map((item) => {
              const isActive =
                location.pathname === item.path ||
                (item.path === '/formulare' &&
                  location.pathname.startsWith('/formular'));
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`nav-link ${isActive ? 'active' : ''}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="nav-icon">
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {menuOpen && <div className="sidebar-overlay" onClick={() => setMenuOpen(false)} />}

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
