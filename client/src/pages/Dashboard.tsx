import React, { useEffect, useState } from 'react';
import { Card, Col, Row, Table, Tag, Modal } from 'antd';
import {
  TeamOutlined,
  ProjectOutlined,
  FileTextOutlined,
  DollarOutlined,
  BankOutlined,
  TransactionOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import request from '../utils/request';
import { useAuth } from '../contexts/AuthContext';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<any>({});
  const { user } = useAuth();

  // Modal states
  const [customersModalOpen, setCustomersModalOpen] = useState(false);
  const [projectsModalOpen, setProjectsModalOpen] = useState(false);
  const [contractsModalOpen, setContractsModalOpen] = useState(false);
  const [suppliersModalOpen, setSuppliersModalOpen] = useState(false);
  const [receivablesModalOpen, setReceivablesModalOpen] = useState(false);
  const [overdueReceivablesModalOpen, setOverdueReceivablesModalOpen] = useState(false);
  const [accountsPayableModalOpen, setAccountsPayableModalOpen] = useState(false);

  // Data states
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [receivables, setReceivables] = useState<any[]>([]);
  const [overdueReceivables, setOverdueReceivables] = useState<any[]>([]);
  const [accountsPayable, setAccountsPayable] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    request.get('/dashboard').then((data: any) => setStats(data));
  }, []);

  const fetchCustomers = async () => {
    setLoading(true);
    try { const data: any = await request.get('/customers'); setCustomers(data); }
    catch { } finally { setLoading(false); }
  };

  const fetchProjects = async () => {
    setLoading(true);
    try { const data: any = await request.get('/projects'); setProjects(data); }
    catch { } finally { setLoading(false); }
  };

  const fetchContracts = async () => {
    setLoading(true);
    try { const data: any = await request.get('/contracts'); setContracts(data); }
    catch { } finally { setLoading(false); }
  };

  const fetchSuppliers = async () => {
    setLoading(true);
    try { const data: any = await request.get('/suppliers'); setSuppliers(data); }
    catch { } finally { setLoading(false); }
  };

  const fetchReceivables = async () => {
    setLoading(true);
    try { const data: any = await request.get('/receivables'); setReceivables(data); }
    catch { } finally { setLoading(false); }
  };

  const fetchOverdueReceivables = async () => {
    setLoading(true);
    try { const data: any = await request.get('/receivables?status=overdue'); setOverdueReceivables(data); }
    catch { } finally { setLoading(false); }
  };

  const fetchAccountsPayable = async () => {
    setLoading(true);
    try { const data: any = await request.get('/accounts-payable'); setAccountsPayable(data); }
    catch { } finally { setLoading(false); }
  };

  const StatCard = ({ title, value, icon, color, bg, prefix, onClick }: any) => (
    // 每行最多 4 个卡片（lg=6），保证内容有充裕宽度
    <Col xs={12} sm={12} md={8} lg={6} xl={6} key={title}>
      <Card
        hoverable
        onClick={onClick}
        style={{
          borderRadius: 16,
          border: '1px solid rgba(0,0,0,0.04)',
          background: bg,
          transition: 'all 0.3s ease',
          cursor: 'pointer',
        }}
        styles={{ body: { padding: '18px 20px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: `linear-gradient(135deg, ${color}20, ${color}10)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 标题：允许两行换行，统一行高，避免被截 */}
            <div
              title={title}
              style={{
                color: '#86868b',
                fontSize: 13,
                lineHeight: '18px',
                marginBottom: 4,
                fontWeight: 500,
                wordBreak: 'break-all',
              }}
            >
              {title}
            </div>
            {/* 值：保持单行但允许字体随宽度自适应 */}
            <div
              title={typeof value === 'number' ? `${prefix || ''}${value.toLocaleString()}` : String(value)}
              style={{
                fontSize: 'clamp(18px, 2vw, 24px)',
                fontWeight: 600,
                color: '#1d1d1f',
                fontFamily: prefix ? 'SF Pro Display, -apple-system, sans-serif' : undefined,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1.25,
              }}
            >
              {prefix}{typeof value === 'number' ? value.toLocaleString() : value}
            </div>
          </div>
        </div>
      </Card>
    </Col>
  );

  const customerColumns = [
    { title: '客户名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '行业', dataIndex: 'industry', key: 'industry', render: (v: string) => v ? <Tag style={{ borderRadius: 6, padding: '2px 10px', border: 'none', background: '#f5f5f7' }}>{v}</Tag> : '-' },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
  ];

  const projectColumns = [
    { title: '项目名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '客户', dataIndex: 'customer_name', key: 'customer_name', render: (v: string) => v || '-' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const map: Record<string, { color: string; label: string }> = {
          active: { color: '#34C759', label: '进行中' },
          completed: { color: '#007AFF', label: '已完成' },
          paused: { color: '#FF9500', label: '暂停' },
          cancelled: { color: '#FF3B30', label: '已取消' },
        };
        const s = map[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
    { title: '负责人', dataIndex: 'manager', key: 'manager' },
    { title: '预算', dataIndex: 'budget', key: 'budget', render: (v: number) => v ? <span style={{ color: '#007AFF', fontWeight: 500 }}>¥{v.toLocaleString()}</span> : '-' },
  ];

  const contractColumns = [
    { title: '合同名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '客户', dataIndex: 'customer_name', key: 'customer_name' },
    { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: number) => <span style={{ color: '#007AFF', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span> },
    { title: '开始日期', dataIndex: 'start_date', key: 'start_date' },
    { title: '结束日期', dataIndex: 'end_date', key: 'end_date' },
  ];

  const supplierColumns = [
    { title: '供应商名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}><BankOutlined style={{ marginRight: 6, color: '#007AFF' }} />{v}</strong> },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '分类', dataIndex: 'category', key: 'category', render: (v: string) => v ? <Tag style={{ borderRadius: 6, padding: '2px 10px', border: 'none', background: '#f5f5f7' }}>{v}</Tag> : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={v === 'active' ? '#34C759' : '#86868b'} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{v === 'active' ? '正常' : '停用'}</Tag> },
  ];

  const receivableColumns = [
    { title: '合同名称', dataIndex: 'contract_name', key: 'contract_name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '客户', dataIndex: 'customer_name', key: 'customer_name' },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '期次', dataIndex: 'period', key: 'period' },
    { title: '应收金额', dataIndex: 'amount', key: 'amount', render: (v: number) => <span style={{ color: '#007AFF', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span> },
    { title: '应收日期', dataIndex: 'due_date', key: 'due_date' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const map: Record<string, { color: string; label: string }> = {
          pending: { color: '#FF9500', label: '待收款' },
          paid: { color: '#34C759', label: '已收款' },
        };
        const s = map[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
  ];

  const overdueReceivableColumns = [
    { title: '合同名称', dataIndex: 'contract_name', key: 'contract_name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '客户', dataIndex: 'customer_name', key: 'customer_name' },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '期次', dataIndex: 'period', key: 'period' },
    { title: '应收金额', dataIndex: 'amount', key: 'amount', render: (v: number) => <span style={{ color: '#FF3B30', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span> },
    { title: '应收日期', dataIndex: 'due_date', key: 'due_date', render: (v: string) => <span style={{ color: '#FF3B30' }}>{v}</span> },
    {
      title: '逾期天数', key: 'overdue_days', render: (_: any, r: any) => {
        if (!r.due_date) return '-';
        const days = Math.ceil((Date.now() - new Date(r.due_date).getTime()) / (1000 * 60 * 60 * 24));
        return <Tag color="#FF3B30" style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{days} 天</Tag>;
      }
    },
  ];

  const accountsPayableColumns = [
    { title: '摘要', dataIndex: 'title', key: 'title', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier_name' },
    { title: '应付金额', dataIndex: 'amount', key: 'amount', render: (v: number) => <span style={{ fontWeight: 600, color: '#1d1d1f' }}>¥{(v || 0).toLocaleString()}</span> },
    { title: '已付金额', dataIndex: 'paid_amount', key: 'paid_amount', render: (v: number) => <span style={{ color: '#34C759', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span> },
    { title: '到期日', dataIndex: 'due_date', key: 'due_date' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const map: Record<string, { color: string; label: string }> = {
          pending: { color: '#FF9500', label: '待付款' },
          partial: { color: '#007AFF', label: '部分付款' },
          paid: { color: '#34C759', label: '已付清' },
        };
        const s = map[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ margin: 0, fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 600, color: '#1d1d1f' }}>
          欢迎回来，{user?.real_name || user?.username}
        </h2>
        <p style={{ color: '#86868b', margin: '6px 0 0', fontSize: 'clamp(13px, 1.5vw, 15px)' }}>以下是您的系统概览，点击卡片查看详情</p>
      </div>

      {/* 第一行：基础统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <StatCard
          title="客户总数"
          value={stats.customerCount || 0}
          icon={<TeamOutlined style={{ fontSize: 18, color: '#007AFF' }} />}
          color="#007AFF"
          bg="linear-gradient(135deg, rgba(0,122,255,0.1), rgba(90,200,250,0.1))"
          onClick={() => { fetchCustomers(); setCustomersModalOpen(true); }}
        />
        <StatCard
          title="活跃项目"
          value={stats.projectCount || 0}
          icon={<ProjectOutlined style={{ fontSize: 18, color: '#34C759' }} />}
          color="#34C759"
          bg="linear-gradient(135deg, rgba(52,199,89,0.1), rgba(48,209,88,0.1))"
          onClick={() => { fetchProjects(); setProjectsModalOpen(true); }}
        />
        <StatCard
          title="活跃合同"
          value={stats.contractCount || 0}
          icon={<FileTextOutlined style={{ fontSize: 18, color: '#AF52DE' }} />}
          color="#AF52DE"
          bg="linear-gradient(135deg, rgba(175,82,222,0.1), rgba(191,90,242,0.1))"
          onClick={() => { fetchContracts(); setContractsModalOpen(true); }}
        />
        <StatCard
          title="合同总金额"
          value={stats.totalAmount || 0}
          prefix="¥"
          icon={<DollarOutlined style={{ fontSize: 18, color: '#FF9500' }} />}
          color="#FF9500"
          bg="linear-gradient(135deg, rgba(255,149,0,0.1), rgba(255,159,10,0.1))"
          onClick={() => { fetchContracts(); setContractsModalOpen(true); }}
        />
      </Row>

      {/* 第二行：应收统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <StatCard
          title="应收总额"
          value={stats.totalReceivable || 0}
          prefix="¥"
          icon={<TransactionOutlined style={{ fontSize: 18, color: '#007AFF' }} />}
          color="#007AFF"
          bg="linear-gradient(135deg, rgba(0,122,255,0.1), rgba(90,200,250,0.1))"
          onClick={() => { fetchReceivables(); setReceivablesModalOpen(true); }}
        />
        <StatCard
          title="已收金额"
          value={stats.receivedAmount || 0}
          prefix="¥"
          icon={<TransactionOutlined style={{ fontSize: 18, color: '#34C759' }} />}
          color="#34C759"
          bg="linear-gradient(135deg, rgba(52,199,89,0.1), rgba(48,209,88,0.1))"
          onClick={() => { fetchReceivables(); setReceivablesModalOpen(true); }}
        />
        <StatCard
          title="逾期应收"
          value={stats.overdueReceivable || 0}
          prefix="¥"
          icon={<ExclamationCircleOutlined style={{ fontSize: 18, color: '#FF3B30' }} />}
          color="#FF3B30"
          bg="linear-gradient(135deg, rgba(255,59,48,0.1), rgba(255,69,58,0.1))"
          onClick={() => { fetchOverdueReceivables(); setOverdueReceivablesModalOpen(true); }}
        />
      </Row>

      {/* 第三行：应付统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <StatCard
          title="供应商总数"
          value={stats.supplierCount || 0}
          icon={<BankOutlined style={{ fontSize: 18, color: '#5AC8FA' }} />}
          color="#5AC8FA"
          bg="linear-gradient(135deg, rgba(90,200,250,0.1), rgba(100,210,255,0.1))"
          onClick={() => { fetchSuppliers(); setSuppliersModalOpen(true); }}
        />
        <StatCard
          title="应付总额"
          value={stats.totalPayable || 0}
          prefix="¥"
          icon={<DollarOutlined style={{ fontSize: 18, color: '#FF9500' }} />}
          color="#FF9500"
          bg="linear-gradient(135deg, rgba(255,149,0,0.1), rgba(255,159,10,0.1))"
          onClick={() => { fetchAccountsPayable(); setAccountsPayableModalOpen(true); }}
        />
        <StatCard
          title="已付总额"
          value={stats.totalPaid || 0}
          prefix="¥"
          icon={<DollarOutlined style={{ fontSize: 18, color: '#34C759' }} />}
          color="#34C759"
          bg="linear-gradient(135deg, rgba(52,199,89,0.1), rgba(48,209,88,0.1))"
          onClick={() => { fetchAccountsPayable(); setAccountsPayableModalOpen(true); }}
        />
      </Row>

      {/* 最近合同 */}
      <Card
        title={<span style={{ fontSize: 'clamp(15px, 2vw, 17px)', fontWeight: 600, color: '#1d1d1f' }}>最近合同</span>}
        style={{
          borderRadius: 16,
          border: '1px solid rgba(0,0,0,0.04)',
        }}
        bordered={false}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          columns={[
            { title: '合同名称', dataIndex: 'name', key: 'name' },
            { title: '客户', dataIndex: 'customer_name', key: 'customer_name' },
            {
              title: '金额',
              dataIndex: 'amount',
              key: 'amount',
              render: (v: number) => <span style={{ color: '#007AFF', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span>
            },
            {
              title: '付款模式',
              dataIndex: 'payment_mode',
              key: 'payment_mode',
              render: (v: string) => {
                const map: Record<string, { label: string; color: string }> = {
                  monthly: { label: '月付', color: '#007AFF' },
                  quarterly: { label: '季付', color: '#5AC8FA' },
                  semiannual: { label: '半年付', color: '#34C759' },
                  annual: { label: '年付', color: '#AF52DE' },
                  once: { label: '一次性', color: '#FF9500' }
                };
                const m = map[v] || { label: v, color: '#86868b' };
                return <Tag color={m.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{m.label}</Tag>;
              }
            },
            { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
          ]}
          dataSource={stats.recentContracts || []}
          rowKey="id"
          pagination={false}
          size="middle"
          style={{ borderRadius: 16 }}
          onRow={() => ({
            onClick: () => {
              setContracts([...stats.recentContracts]);
              setContractsModalOpen(true);
            },
            style: { cursor: 'pointer' }
          })}
        />
      </Card>

      {/* 客户列表弹窗 */}
      <Modal
        title={<span style={{ fontSize: 17, fontWeight: 600, color: '#1d1d1f' }}>客户列表</span>}
        open={customersModalOpen}
        onCancel={() => setCustomersModalOpen(false)}
        footer={null}
        width={800}
        styles={{ body: { padding: '20px' } }}
      >
        <Table
          columns={customerColumns}
          dataSource={customers}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 8 }}
          size="middle"
        />
      </Modal>

      {/* 项目列表弹窗 */}
      <Modal
        title={<span style={{ fontSize: 17, fontWeight: 600, color: '#1d1d1f' }}>项目列表</span>}
        open={projectsModalOpen}
        onCancel={() => setProjectsModalOpen(false)}
        footer={null}
        width={900}
        styles={{ body: { padding: '20px' } }}
      >
        <Table
          columns={projectColumns}
          dataSource={projects}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 8 }}
          size="middle"
        />
      </Modal>

      {/* 合同列表弹窗 */}
      <Modal
        title={<span style={{ fontSize: 17, fontWeight: 600, color: '#1d1d1f' }}>合同列表</span>}
        open={contractsModalOpen}
        onCancel={() => setContractsModalOpen(false)}
        footer={null}
        width={1000}
        styles={{ body: { padding: '20px' } }}
      >
        <Table
          columns={contractColumns}
          dataSource={contracts}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 8 }}
          size="middle"
        />
      </Modal>

      {/* 供应商列表弹窗 */}
      <Modal
        title={<span style={{ fontSize: 17, fontWeight: 600, color: '#1d1d1f' }}>供应商列表</span>}
        open={suppliersModalOpen}
        onCancel={() => setSuppliersModalOpen(false)}
        footer={null}
        width={900}
        styles={{ body: { padding: '20px' } }}
      >
        <Table
          columns={supplierColumns}
          dataSource={suppliers}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 8 }}
          size="middle"
        />
      </Modal>

      {/* 应收账款弹窗 */}
      <Modal
        title={<span style={{ fontSize: 17, fontWeight: 600, color: '#007AFF' }}>应收账款列表</span>}
        open={receivablesModalOpen}
        onCancel={() => setReceivablesModalOpen(false)}
        footer={null}
        width={1100}
        styles={{ body: { padding: '20px' } }}
      >
        <Table
          columns={receivableColumns}
          dataSource={receivables}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          size="middle"
        />
      </Modal>

      {/* 逾期应收弹窗 */}
      <Modal
        title={<span style={{ fontSize: 17, fontWeight: 600, color: '#FF3B30' }}>逾期应收列表</span>}
        open={overdueReceivablesModalOpen}
        onCancel={() => setOverdueReceivablesModalOpen(false)}
        footer={null}
        width={1100}
        styles={{ body: { padding: '20px' } }}
      >
        <Table
          columns={overdueReceivableColumns}
          dataSource={overdueReceivables}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          size="middle"
        />
      </Modal>

      {/* 应付账款弹窗 */}
      <Modal
        title={<span style={{ fontSize: 17, fontWeight: 600, color: '#1d1d1f' }}>应付账款列表</span>}
        open={accountsPayableModalOpen}
        onCancel={() => setAccountsPayableModalOpen(false)}
        footer={null}
        width={1000}
        styles={{ body: { padding: '20px' } }}
      >
        <Table
          columns={accountsPayableColumns}
          dataSource={accountsPayable}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 8 }}
          size="middle"
        />
      </Modal>
    </div>
  );
};

export default Dashboard;
