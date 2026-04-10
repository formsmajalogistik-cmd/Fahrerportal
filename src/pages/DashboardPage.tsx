import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchFormulare, fetchOffeneFormulare } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Formular, OffenesFormular } from '../types/sharepoint';
import './DashboardPage.css';

export function DashboardPage() {
  const { token, user } = useAuth();
  const [formulare, setFormulare] = useState<Formular[]>([]);
  const [offene, setOffene] = useState<OffenesFormular[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [f, o] = await Promise.all([
        fetchFormulare(token),
        fetchOffeneFormulare(token),
      ]);
      setFormulare(f);
      setOffene(o);
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

  const zugewiesen = formulare.filter((f) => f.status === 'Zugewiesen').length;
  const inBearbeitung = formulare.filter((f) => f.status === 'In Bearbeitung').length;
  const ueberfaellig = formulare.filter((f) => f.status === 'Überfällig').length;
  const abgeschlossen = formulare.filter((f) => f.status === 'Abgeschlossen').length;

  const cards = [
    { label: 'Zugewiesen', value: zugewiesen, color: '#2196f3', path: '/formulare' },
    { label: 'In Bearbeitung', value: inBearbeitung, color: '#ff9800', path: '/formulare' },
    { label: 'Überfällig', value: ueberfaellig, color: '#f44336', path: '/formulare' },
    { label: 'Abgeschlossen', value: abgeschlossen, color: '#4caf50', path: '/formulare' },
    { label: 'Offene Formulare', value: offene.length, color: '#9c27b0', path: '/offen' },
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
