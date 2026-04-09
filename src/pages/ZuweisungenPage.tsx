import { useState, useEffect } from 'react';
import { getZuweisungen } from '../services/sharepointService';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Fahrerzuweisung } from '../types/sharepoint';
import './TablePage.css';

export function ZuweisungenPage() {
  const [zuweisungen, setZuweisungen] = useState<Fahrerzuweisung[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      setZuweisungen(await getZuweisungen());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Zuweisungen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = zuweisungen.filter(
    (z) =>
      z.fahrerName.toLowerCase().includes(search.toLowerCase()) ||
      z.formularTitel.toLowerCase().includes(search.toLowerCase())
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

  const formatDate = (d: string) => {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString('de-DE');
    } catch {
      return d;
    }
  };

  if (loading) return <LoadingSpinner text="Zuweisungen werden geladen..." />;
  if (error) return <ErrorMessage message={error} onRetry={loadData} />;

  return (
    <div className="table-page">
      <div className="page-header">
        <h1 className="page-title">Fahrerzuweisungen</h1>
        <span className="record-count">{zuweisungen.length} Einträge</span>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Zuweisungen suchen..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Fahrer</th>
              <th>Formular</th>
              <th>Zugewiesen am</th>
              <th>Fällig am</th>
              <th>Priorität</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-row">
                  Keine Zuweisungen gefunden
                </td>
              </tr>
            ) : (
              filtered.map((z) => (
                <tr key={z.id}>
                  <td className="font-medium">{z.fahrerName}</td>
                  <td>{z.formularTitel}</td>
                  <td>{formatDate(z.zuweisungsDatum)}</td>
                  <td>{formatDate(z.faelligkeitsDatum)}</td>
                  <td>
                    <span className={prioClass(z.prioritaet)}>{z.prioritaet}</span>
                  </td>
                  <td>
                    <span className={statusClass(z.status)}>{z.status}</span>
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
