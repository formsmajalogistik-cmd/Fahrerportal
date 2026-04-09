import { useState, useEffect } from 'react';
import { getFormulare } from '../services/sharepointService';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Formular } from '../types/sharepoint';
import './TablePage.css';

export function FormularePage() {
  const [formulare, setFormulare] = useState<Formular[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      setFormulare(await getFormulare());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Formulare');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = formulare.filter(
    (f) =>
      f.titel.toLowerCase().includes(search.toLowerCase()) ||
      f.kategorie.toLowerCase().includes(search.toLowerCase())
  );

  const statusClass = (status: string) => {
    switch (status) {
      case 'Aktiv': return 'badge badge-success';
      case 'Entwurf': return 'badge badge-warning';
      case 'Archiviert': return 'badge badge-muted';
      default: return 'badge';
    }
  };

  if (loading) return <LoadingSpinner text="Formulare werden geladen..." />;
  if (error) return <ErrorMessage message={error} onRetry={loadData} />;

  return (
    <div className="table-page">
      <div className="page-header">
        <h1 className="page-title">Formulare</h1>
        <span className="record-count">{formulare.length} Einträge</span>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Formulare suchen..."
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
              <th>Version</th>
              <th>Pflicht</th>
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
                  <td>{f.version}</td>
                  <td>{f.pflicht ? 'Ja' : 'Nein'}</td>
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
