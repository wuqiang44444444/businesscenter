import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import MainLayout from './components/MainLayout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import Projects from './pages/Projects';
import Contracts from './pages/Contracts';
import Suppliers from './pages/Suppliers';
import AccountsPayable from './pages/AccountsPayable';
import Invoices from './pages/Invoices';
import Users from './pages/Users';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin size="large" /></div>;
  if (!user) return <Navigate to="/login" />;
  // 必须改密：拦截到 /change-password，避免用户绕过强制改密直接用其它页面
  if (user.must_change_password && window.location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
};

const App: React.FC = () => (
  <ConfigProvider locale={zhCN} theme={{
    token: {
      colorPrimary: '#007AFF',
      colorSuccess: '#34C759',
      colorWarning: '#FF9500',
      colorError: '#FF3B30',
      colorInfo: '#5AC8FA',
      borderRadius: 12,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    components: {
      Menu: { darkItemBg: 'transparent', darkItemSelectedBg: 'rgba(255,255,255,0.15)' },
      Card: { borderRadiusLG: 16 },
      Button: { borderRadius: 10, controlHeight: 40 },
      Input: { borderRadius: 10, controlHeight: 40 },
      Modal: { borderRadiusLG: 20 },
      Table: { borderRadiusLG: 12 },
      Select: { borderRadius: 10 },
    }
  }}>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
          <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="customers" element={<Customers />} />
            <Route path="projects" element={<Projects />} />
            <Route path="contracts" element={<Contracts />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="accounts-payable" element={<AccountsPayable />} />
            <Route path="users" element={<Users />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </ConfigProvider>
);

export default App;
