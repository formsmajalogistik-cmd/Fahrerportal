import { useState, useEffect } from 'react';
import { getFahrer } from '../services/sharepointService';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Fahrer } from '../types/sharepoint';
import './TablePage.css';

export function FahrerPage() {
  const [fahrer, setFahrer] = useState<Fahrer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      setFahrer(await getFahrer());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Fahrer');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = fahrer.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.vorname.toLowerCase().includes(search.toLowerCase()) ||
      f.email.toLowerCase().includes(search.toLowerCase())
  );

  const statusClass = (status: string) => {
    switch (status) {
      case 'Aktiv': return 'badge badge-success';
      case 'Inaktiv': return 'badge badge-danger';
      case 'Urlaub': return 'badge badge-warning';
      default: return 'badge';
    }
  };

  if (loading) return <LoadingSpinner text="Fahrer werden geladen..." />;
  if (error) return <ErrorMessage message={error} onRetry={loadData} />;

  return (
    <div className="table-page">
      <div className="page-header">
        <h1 className="page-title">Fahrer</h1>
        <span className="record-count">{fahrer.length} Einträge</span>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Fahrer suchen..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Vorname</th>
              <th>E-Mail</th>
              <th>Telefon</th>
              <th>Führerschein</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-row">
                  Keine Fahrer gefunden
                </td>
              </tr>
            ) : (
              filtered.map((f) => (
                <tr key={f.id}>
                  <td className="font-medium">{f.name}</td>
                  <td>{f.vorname}</td>
                  <td>{f.email}</td>
                  <td>{f.telefon}</td>
                  <td>{f.fuehrerscheinklasse}</td>
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
