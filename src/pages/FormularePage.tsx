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
      f.titel.toLowerCase().includes(search.toLowerCase()) ||
      f.kategorie.toLowerCase().includes(search.toLowerCase())
  );

  const statusClass = (status: string) => {
    switch (status) {
      case 'Abgeschlossen': return 'badge badge-success';
      case 'In Bearbeitung': return 'badge badge-info';
      case 'Zugewiesen': return 'badge badge-warning';
      case 'Überfällig': return 'badge badge-danger';
      default: return 'badge';
    }
  };

  const prioClass = (prio: string) => {
    switch (prio) {
      case 'Hoch': return 'badge badge-danger';
      case 'Mittel': return 'badge badge-warning';
      case 'Niedrig': return 'badge badge-muted';
      default: return 'badge';
    }
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    try { return new Date(d).toLocaleDateString('de-DE'); } catch { return d; }
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
              <th>Titel</th>
              <th>Kategorie</th>
              <th>Fällig am</th>
              <th>Priorität</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-row">
                  Keine Formulare gefunden
                </td>
              </tr>
            ) : (
              filtered.map((f) => (
                <tr key={f.id}>
                  <td className="font-medium">{f.titel}</td>
                  <td>{f.kategorie}</td>
                  <td>{formatDate(f.faelligkeitsDatum)}</td>
                  <td>
                    <span className={prioClass(f.prioritaet)}>{f.prioritaet}</span>
                  </td>
                  <td>
                    <span className={statusClass(f.status)}>{f.status}</span>
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
