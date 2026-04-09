import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardStats } from '../services/sharepointService';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import type { DashboardStats } from '../types/sharepoint';
import './DashboardPage.css';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Dashboard-Daten');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  if (loading) return <LoadingSpinner text="Dashboard wird geladen..." />;
  if (error) return <ErrorMessage message={error} onRetry={loadStats} />;
  if (!stats) return null;

  const cards = [
    {
      label: 'Aktive Fahrer',
      value: stats.aktiveFahrer,
      total: stats.totalFahrer,
      color: '#4caf50',
      path: '/fahrer',
    },
    {
      label: 'Formulare',
      value: stats.totalFormulare,
      color: '#2196f3',
      path: '/formulare',
    },
    {
      label: 'Offene Formulare',
      value: stats.offeneFormulare,
      color: '#ff9800',
      path: '/offen',
    },
    {
      label: 'Überfällig',
      value: stats.ueberfaellig,
      color: '#f44336',
      path: '/zuweisungen',
    },
    {
      label: 'Abgeschlossen',
      value: stats.abgeschlossen,
      color: '#4caf50',
      path: '/zuweisungen',
    },
  ];

  return (
    <div className="dashboard">
      <h1 className="page-title">Dashboard</h1>
      <div className="stats-grid">
        {cards.map((card) => (
          <button
            key={card.label}
            className="stat-card"
            onClick={() => navigate(card.path)}
            style={{ borderTopColor: card.color }}
          >
            <div className="stat-value" style={{ color: card.color }}>
              {card.value}
            </div>
            <div className="stat-label">{card.label}</div>
            {card.total !== undefined && (
              <div className="stat-sub">von {card.total} gesamt</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
