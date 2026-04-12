import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchFormulare, fetchOffeneFormulare } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { Icon } from '../components/Icon';
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
      // Formulare are critical — if this fails, show an error.
      const forms = await fetchFormulare(token);
      setFormulare(forms);

      // Offene Formulare are optional — if the list doesn't exist or
      // SharePoint returns an error, silently fall back to [].
      try {
        setOffene(await fetchOffeneFormulare(token, 'Offen'));
      } catch {
        console.warn('OffeneFormulare konnten nicht geladen werden');
        setOffene([]);
      }
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
    {
      label: 'Formulare gesamt',
      value: gesamt,
      letter: 'F',
      color: 'var(--ml-primary)',
      path: '/formulare',
    },
    {
      label: 'Wiederkehrend',
      value: wiederkehrend,
      letter: 'W',
      color: 'var(--ml-accent)',
      path: '/formulare',
    },
    {
      label: 'Einmalig',
      value: einmalig,
      letter: 'E',
      color: 'var(--ml-accent)',
      path: '/formulare',
    },
    // Only show "Offen" card if there are actually open entries
    ...(offene.length > 0
      ? [
          {
            label: 'Offen',
            value: offene.length,
            letter: 'O',
            color: 'var(--ml-warning)',
            path: '/dashboard',
          },
        ]
      : []),
  ];

  const handleFortsetzen = (entry: OffenesFormular) => {
    const form = formulare.find(
      (f) => f.formularname.toLowerCase() === entry.formularname.toLowerCase()
    );
    if (!form || !form.filloutUrl) {
      alert('Das zugehörige Formular ist nicht mehr aktiv oder wurde entfernt.');
      return;
    }
    navigate('/formular', {
      state: {
        filloutUrl: form.filloutUrl,
        formularname: form.formularname,
        offenesId: entry.id,
        fahrzeug: entry.fahrzeug,
      },
    });
  };

  const formatTimestamp = (iso: string): string => {
    if (!iso) return '–';
    try {
      return new Date(iso).toLocaleString('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-greeting">
        <h1 className="greeting-title">
          Willkommen{user ? `, ${user.vorname}` : ''}
        </h1>
        <p className="greeting-sub">Übersicht deiner Aufgaben und offenen Formulare</p>
      </div>

      <div className="section-header">
        <h2>Überblick</h2>
      </div>
      <div className="stats-grid">
        {cards.map((card) => (
          <button
            key={card.label}
            className="stat-card"
            onClick={() => navigate(card.path)}
          >
            <div className="stat-icon" style={{ background: card.color }}>
              {card.letter}
            </div>
            <div className="stat-text">
              <div className="stat-value">{card.value}</div>
              <div className="stat-label">{card.label}</div>
            </div>
          </button>
        ))}
      </div>

      {offene.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: '2rem' }}>
            <h2>Offene Formulare</h2>
            <span className="section-sub">{offene.length} offen</span>
          </div>
          <ul className="offene-list">
            {offene.map((entry) => (
              <li key={entry.id} className="offene-item">
                <div className="offene-meta">
                  <div className="offene-name">{entry.formularname}</div>
                  <div className="offene-sub">
                    <span className="offene-fahrzeug">
                      <Icon name="truck" size={14} />
                      {entry.fahrzeug || 'Kein Fahrzeug'}
                    </span>
                    <span className="offene-time">
                      <Icon name="clock" size={14} />
                      {formatTimestamp(entry.begonnen)}
                    </span>
                  </div>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => handleFortsetzen(entry)}
                >
                  <span>Fortsetzen</span>
                  <Icon name="arrow-right" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
