import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchFormulare } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Formular } from '../types/sharepoint';
import './TablePage.css';

export function FormularePage() {
  const { token } = useAuth();
  const [formulare, setFormulare] = useState<Formular[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setFormulare(await fetchFormulare(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Formulare');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filtered = formulare.filter(
    (f) =>
      f.formularname.toLowerCase().includes(search.toLowerCase()) ||
      f.art.toLowerCase().includes(search.toLowerCase())
  );

  const artClass = (art: string) => {
    switch (art) {
      case 'Wiederkehrend': return 'badge badge-info';
      case 'Einmalig': return 'badge badge-warning';
      default: return 'badge';
    }
  };

  if (loading) return <LoadingSpinner text="Formulare werden geladen…" />;
  if (error) return <ErrorMessage message={error} onRetry={loadData} />;

  return (
    <div className="table-page">
      <div className="page-header">
        <h1 className="page-title">Meine Formulare</h1>
        <span className="record-count">{formulare.length} Einträge</span>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Formulare suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Formular</th>
              <th>Art</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-row">
                  Keine Formulare gefunden
                </td>
              </tr>
            ) : (
              filtered.map((f) => (
                <tr key={f.id}>
                  <td className="font-medium">{f.formularname}</td>
                  <td>
                    <span className={artClass(f.art)}>{f.art}</span>
                  </td>
                  <td>
                    {f.filloutUrl ? (
                      <a
                        className="btn-primary"
                        href={f.filloutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Öffnen
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
