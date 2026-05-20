import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import MainLayout from './components/MainLayout';

// 登录页保持同步加载（首屏要用），其余页面按路由懒加载
import Login from './pages/Login';
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Customers = lazy(() => import('./pages/Customers'));
const Projects = lazy(() => import('./pages/Projects'));
const Contracts = lazy(() => import('./pages/Contracts'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const AccountsPayable = lazy(() => import('./pages/AccountsPayable'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Reports = lazy(() => import('./pages/Reports'));
const BankAccounts = lazy(() => import('./pages/BankAccounts'));
const Reimbursements = lazy(() => import('./pages/Reimbursements'));
const CustomReports = lazy(() => import('./pages/CustomReports'));
const Users = lazy(() => import('./pages/Users'));

const RouteSpinner: React.FC = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}>
    <Spin size="large" />
  </div>
);

// 路由 → 页面标题映射，配合 document.title 让浏览器 tab 显示具体页面
const TITLE_MAP: Record<string, string> = {
  '/': '仪表盘',
  '/customers': '客户管理',
  '/projects': '项目管理',
  '/contracts': '合同管理',
  '/invoices': '发票管理',
  '/suppliers': '供应商管理',
  '/accounts-payable': '应付账款',
  '/reports': '报表统计',
  '/bank-accounts': '银行账户',
  '/reimbursements': '费用报销',
  '/custom-reports': '自定义报表',
  '/users': '用户管理',
  '/login': '登录',
  '/change-password': '修改密码',
};

const DocumentTitle: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const sub = TITLE_MAP[pathname];
    document.title = sub ? `Business · ${sub}` : 'Business';
  }, [pathname]);
  return null;
};

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
      colorTextBase: '#1d1d1f',
      colorBgLayout: '#f5f5f7',
      borderRadius: 10,
      borderRadiusLG: 14,
      borderRadiusSM: 8,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: 14,
      controlHeight: 38,
      // 更柔和的阴影 token
      boxShadowSecondary: '0 6px 16px 0 rgba(0,0,0,0.06), 0 3px 6px -4px rgba(0,0,0,0.08)',
      boxShadowTertiary: '0 1px 2px 0 rgba(0,0,0,0.04)',
    },
    components: {
      Menu: { darkItemBg: 'transparent', darkItemSelectedBg: 'rgba(255,255,255,0.15)', darkItemHoverBg: 'rgba(255,255,255,0.06)' },
      Card: { borderRadiusLG: 16, paddingLG: 24 },
      Button: { borderRadius: 10, controlHeight: 38, fontWeight: 500 },
      Input: { borderRadius: 10, controlHeight: 38 },
      Modal: { borderRadiusLG: 20 },
      Table: { borderRadiusLG: 12, headerBg: '#fafafb', cellPaddingBlock: 14 },
      Select: { borderRadius: 10, controlHeight: 38 },
      Tabs: { itemColor: '#86868b', itemSelectedColor: '#007AFF', inkBarColor: '#007AFF' },
      Tag: { borderRadiusSM: 6 },
      Statistic: { titleFontSize: 13, contentFontSize: 26 },
    }
  }}>
    <BrowserRouter>
      <AuthProvider>
        <DocumentTitle />
        <Suspense fallback={<RouteSpinner />}>
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
              <Route path="reports" element={<Reports />} />
              <Route path="bank-accounts" element={<BankAccounts />} />
              <Route path="reimbursements" element={<Reimbursements />} />
              <Route path="custom-reports" element={<CustomReports />} />
              <Route path="users" element={<Users />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  </ConfigProvider>
);

export default App;
