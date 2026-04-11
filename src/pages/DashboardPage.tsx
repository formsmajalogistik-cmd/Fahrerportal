import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchFormulare } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Formular } from '../types/sharepoint';
import './DashboardPage.css';

export function DashboardPage() {
  const { token, user } = useAuth();
  const [formulare, setFormulare] = useState<Formular[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setFormulare(await fetchFormulare(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loading) return <LoadingSpinner text="Dashboard wird geladen…" />;
  if (error) return <ErrorMessage message={error} onRetry={loadData} />;

  const gesamt = formulare.length;
  const wiederkehrend = formulare.filter((f) => f.art === 'Wiederkehrend').length;
  const einmalig = formulare.filter((f) => f.art === 'Einmalig').length;

  const cards = [
    { label: 'Formulare gesamt', value: gesamt, color: '#2196f3', path: '/formulare' },
    { label: 'Wiederkehrend', value: wiederkehrend, color: '#4caf50', path: '/formulare' },
    { label: 'Einmalig', value: einmalig, color: '#ff9800', path: '/formulare' },
  ];

  return (
    <div className="dashboard">
      <h1 className="page-title">Willkommen{user ? `, ${user.vorname}` : ''}</h1>
      <p className="page-subtitle">Übersicht deiner Aufgaben</p>
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
          </button>
        ))}
      </div>
    </div>
  );
}
