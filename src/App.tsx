import { Routes, Route, Navigate } from 'react-router-dom';
import { useIsAuthenticated } from '@azure/msal-react';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { FahrerPage } from './pages/FahrerPage';
import { FormularePage } from './pages/FormularePage';
import { ZuweisungenPage } from './pages/ZuweisungenPage';
import { OffeneFormularePage } from './pages/OffeneFormularePage';

function App() {
  const isAuthenticated = useIsAuthenticated();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/fahrer" element={<FahrerPage />} />
        <Route path="/formulare" element={<FormularePage />} />
        <Route path="/zuweisungen" element={<ZuweisungenPage />} />
        <Route path="/offen" element={<OffeneFormularePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
