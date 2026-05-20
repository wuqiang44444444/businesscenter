import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Layout, Menu, Dropdown, Avatar, Tag, Badge, List } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  ProjectOutlined,
  FileTextOutlined,
  UserOutlined,
  LogoutOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BankOutlined,
  AccountBookOutlined,
  BellOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import request from '../utils/request';

const { Header, Sider, Content } = Layout;

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const hasInitialized = useRef(false);

  // 合同审批徽章
  const renderContractLabel = () => pendingApprovals > 0
    ? <span>合同管理 <Badge count={pendingApprovals} size="small" style={{ marginLeft: 6 }} /></span>
    : '合同管理';

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/customers', icon: <TeamOutlined />, label: '客户管理' },
    { key: '/projects', icon: <ProjectOutlined />, label: '项目管理' },
    { key: '/contracts', icon: <FileTextOutlined />, label: renderContractLabel() },
    { key: '/invoices', icon: <FileTextOutlined />, label: '发票管理' },
    { key: '/suppliers', icon: <BankOutlined />, label: '供应商管理' },
    { key: '/accounts-payable', icon: <AccountBookOutlined />, label: '应付账款' },
    { key: '/reports', icon: <BarChartOutlined />, label: '报表统计' },
    { key: '/bank-accounts', icon: <BankOutlined />, label: '银行账户' },
    ...(isAdmin || user?.role === 'finance' ? [{ key: '/users', icon: <UserOutlined />, label: '用户管理' }] : []),
  ];

  const fetchNotifications = useCallback(async () => {
    try {
      const data: any = await request.get('/notifications');
      setNotifications(data);
      const count: any = await request.get('/notifications/unread-count');
      setUnreadCount(count.count || 0);
    } catch { }
  }, []); // 空依赖数组，防止无限循环

  const markAsRead = async (id: string) => {
    try {
      await request.put(`/notifications/${id}/read`);
      fetchNotifications();
    } catch { }
  };

  // 根据通知类型跳转到相关页面
  const handleNotificationClick = async (item: any) => {
    await markAsRead(item.id);
    setNotificationsOpen(false);

    if (item.related_type === 'invoice' && item.related_id) {
      // 发票通知：先获取发票详情得到合同ID，然后跳转到合同页面并打开发票弹窗
      try {
        const invoice: any = await request.get(`/invoices/${item.related_id}`);
        navigate(`/contracts?openInvoices=true&contractId=${invoice.contract_id}`);
      } catch {
        navigate('/contracts');
      }
    } else if (item.related_type === 'contract' && item.related_id) {
      navigate(`/contracts?openDetail=true&contractId=${item.related_id}`);
    } else {
      // 默认跳转
      navigate('/');
    }
  };

  const markAllAsRead = async () => {
    try {
      await request.put('/notifications/read-all');
      fetchNotifications();
    } catch { }
  };

  useEffect(() => {
    if (user && !hasInitialized.current) {
      hasInitialized.current = true;
      fetchNotifications();
      const fetchPending = async () => {
        try {
          const r: any = await request.get('/contracts/_pending_count');
          setPendingApprovals(r.count || 0);
        } catch { }
      };
      fetchPending();
      // 定时轮询未读数量 + 待审批数
      const interval = setInterval(async () => {
        try {
          const count: any = await request.get('/notifications/unread-count');
          setUnreadCount(count.count || 0);
        } catch { }
        fetchPending();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [user?.id, fetchNotifications]); // 只依赖 user?.id，避免整个对象变化时重新执行

  const dropdownItems = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: user?.real_name || user?.username, disabled: true },
      { type: 'divider' as const },
      { key: 'change-password', icon: <LockOutlined />, label: '修改密码' },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
    ],
    onClick: async ({ key }: { key: string }) => {
      if (key === 'change-password') {
        navigate('/change-password');
      } else if (key === 'logout') {
        await logout();
        navigate('/login');
      }
    },
  };

  const getRoleColor = (role: string) => {
    if (role === 'admin') return '#FF3B30';
    if (role === 'finance') return '#FF9500';
    return '#007AFF';
  };

  const getRoleLabel = (role: string) => {
    if (role === 'admin') return '管理员';
    if (role === 'finance') return '财务';
    return '用户';
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f5f7fa 0%, #eaeef5 100%)' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={232}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
          boxShadow: '1px 0 0 rgba(0,0,0,0.04), 4px 0 24px rgba(0,0,0,0.06)',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: collapsed ? 18 : 20,
          fontWeight: 600,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          letterSpacing: collapsed ? 0 : 1,
        }}>
          {collapsed ? (
            <span style={{ background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: 22, fontWeight: 700, letterSpacing: 0 }}>B</span>
          ) : (
            <span style={{ background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>
              Business
            </span>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{
            borderRight: 0,
            background: 'transparent',
            fontSize: 14,
            padding: '12px 8px',
          }}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 232, transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }}>
        <Header style={{
          padding: '0 28px',
          height: 60,
          lineHeight: '60px',
          background: 'rgba(255, 255, 255, 0.78)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(0,0,0,0.04)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}>
          <div style={{ cursor: 'pointer', fontSize: 18, color: '#1d1d1f' }} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* 通知铃铛 */}
            <Dropdown
              open={notificationsOpen}
              onOpenChange={(visible) => { if (visible) fetchNotifications(); setNotificationsOpen(visible); }}
              dropdownRender={() => (
                <div style={{ width: 380, maxHeight: 400, background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#1d1d1f' }}>通知</span>
                    {unreadCount > 0 && (
                      <a onClick={markAllAsRead} style={{ fontSize: 12, color: '#007AFF' }}>全部已读</a>
                    )}
                  </div>
                  {notifications.length > 0 ? (
                    <List
                      size="small"
                      dataSource={notifications}
                      renderItem={(item: any) => (
                        <List.Item
                          style={{
                            padding: '10px 16px',
                            cursor: 'pointer',
                            background: item.is_read === '0' ? 'rgba(0,122,255,0.05)' : 'transparent',
                          }}
                          onClick={() => handleNotificationClick(item)}
                        >
                          <div style={{ width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontSize: 13, fontWeight: 500, color: item.is_read === '0' ? '#1d1d1f' : '#86868b' }}>{item.title}</span>
                              <span style={{ fontSize: 11, color: '#86868b' }}>{new Date(item.created_at).toLocaleDateString()}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#86868b' }}>{item.content}</div>
                          </div>
                        </List.Item>
                      )}
                    />
                  ) : (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#86868b', fontSize: 13 }}>暂无通知</div>
                  )}
                </div>
              )}
            >
              <Badge count={unreadCount} overflowCount={99}>
                <div style={{ cursor: 'pointer', fontSize: 18, color: '#86868b' }}>
                  <BellOutlined />
                </div>
              </Badge>
            </Dropdown>

            {/* 用户信息 */}
            <Dropdown menu={dropdownItems}>
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar
                  style={{
                    background: 'linear-gradient(135deg, #007AFF, #5AC8FA)',
                    boxShadow: '0 2px 8px rgba(0,122,255,0.3)'
                  }}
                  icon={<UserOutlined />}
                />
                <span style={{ color: '#1d1d1f', fontSize: 15, fontWeight: 500 }}>{user?.real_name || user?.username}</span>
                <Tag
                  color={getRoleColor(user?.role || 'user')}
                  style={{
                    borderRadius: 6,
                    fontSize: 12,
                    padding: '2px 10px',
                    border: 'none'
                  }}
                >
                  {getRoleLabel(user?.role || 'user')}
                </Tag>
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content style={{
          margin: '20px 24px 24px',
          padding: '24px 28px',
          minHeight: 'calc(100vh - 104px)',
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 16,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 6px 24px rgba(0,0,0,0.04)',
          border: '1px solid rgba(255,255,255,0.5)',
        }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
