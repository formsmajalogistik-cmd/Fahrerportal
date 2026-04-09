import { useState, useEffect } from 'react';
import { getOffeneFormulare } from '../services/sharepointService';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import type { OffenesFormular } from '../types/sharepoint';
import './TablePage.css';

export function OffeneFormularePage() {
  const [formulare, setFormulare] = useState<OffenesFormular[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      setFormulare(await getOffeneFormulare());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der offenen Formulare');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = formulare.filter(
    (f) =>
      f.formularTitel.toLowerCase().includes(search.toLowerCase()) ||
      f.fahrerName.toLowerCase().includes(search.toLowerCase())
  );

  const statusClass = (status: string) => {
    switch (status) {
      case 'Genehmigt': return 'badge badge-success';
      case 'In Prüfung': return 'badge badge-info';
      case 'Offen': return 'badge badge-warning';
      case 'Abgelehnt': return 'badge badge-danger';
      default: return 'badge';
    }
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString('de-DE');
    } catch {
      return d;
    }
  };

  if (loading) return <LoadingSpinner text="Offene Formulare werden geladen..." />;
  if (error) return <ErrorMessage message={error} onRetry={loadData} />;

  return (
    <div className="table-page">
      <div className="page-header">
        <h1 className="page-title">Offene Formulare</h1>
        <span className="record-count">{formulare.length} Einträge</span>
      </div>

      <div className="toolbar">
        <input
          type="search"
          className="search-input"
          placeholder="Offene Formulare suchen..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Formular</th>
              <th>Fahrer</th>
              <th>Eingereicht am</th>
              <th>Status</th>
              <th>Kommentar</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-row">
                  Keine offenen Formulare gefunden
                </td>
              </tr>
            ) : (
              filtered.map((f) => (
                <tr key={f.id}>
                  <td className="font-medium">{f.formularTitel}</td>
                  <td>{f.fahrerName}</td>
                  <td>{formatDate(f.eingereichtAm)}</td>
                  <td>
                    <span className={statusClass(f.status)}>{f.status}</span>
                  </td>
                  <td className="comment-cell">{f.kommentar || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
