import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { FormularePage } from './pages/FormularePage';
import { FormularEmbedPage } from './pages/FormularEmbedPage';

function App() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/formulare" element={<FormularePage />} />
        <Route path="/formular" element={<FormularEmbedPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
