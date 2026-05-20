// 应收账款页：active 合同的收款计划视图 + 标记已收
import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, DatePicker, Space, message,
  Row, Col, Statistic, Tooltip,
} from 'antd';
import { CheckCircleOutlined, RollbackOutlined, EditOutlined, SearchOutlined, InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import request from '../utils/request';

interface Plan {
  id: string;
  contract_id: string;
  contract_name: string;
  contract_no?: string;
  customer_id: string;
  customer_name: string;
  contact_person?: string;
  phone?: string;
  period: string;
  amount: number;
  due_date: string | null;
  actual_date: string | null;
  status: 'pending' | 'paid' | 'overdue';
  remark?: string;
  bank_account_id?: string | null;
  bank_account_name?: string | null;
}

const yuanFmt = (n: number) => `¥${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => dayjs().format('YYYY-MM-DD');

// 计算"实际状态"：pending 且过期 → overdue（只展示用，不改 DB）
function displayStatus(p: Plan): 'pending' | 'paid' | 'overdue' {
  if (p.status === 'paid') return 'paid';
  if (p.due_date && p.due_date < today()) return 'overdue';
  return 'pending';
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  pending: { color: '#FF9500', label: '待收' },
  paid: { color: '#34C759', label: '已收' },
  overdue: { color: '#FF3B30', label: '逾期' },
};

const Receivables: React.FC = () => {
  const [list, setList] = useState<Plan[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 筛选
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [customerFilter, setCustomerFilter] = useState<string>('');
  const [keyword, setKeyword] = useState('');

  // 操作弹窗
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<Plan | null>(null);
  const [payForm] = Form.useForm();

  const [remarkOpen, setRemarkOpen] = useState(false);
  const [remarkTarget, setRemarkTarget] = useState<Plan | null>(null);
  const [remarkForm] = Form.useForm();

  const fetchAll = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      if (customerFilter) params.customer_id = customerFilter;
      if (keyword) params.keyword = keyword;
      const [rows, cust, bk]: any[] = await Promise.all([
        request.get('/receivables', { params }),
        request.get('/customers'),
        request.get('/bank-accounts'),
      ]);
      setList(rows);
      setCustomers(cust);
      setBanks(bk);
    } catch (e: any) {
      message.error(e.error || '加载失败');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [statusFilter, customerFilter]);

  const stats = useMemo(() => {
    let total = 0, received = 0, outstanding = 0, overdue = 0;
    for (const p of list) {
      const ds = displayStatus(p);
      total += p.amount;
      if (ds === 'paid') received += p.amount;
      else outstanding += p.amount;
      if (ds === 'overdue') overdue += p.amount;
    }
    return { total, received, outstanding, overdue };
  }, [list]);

  // ----- 标记已收 -----
  const openPay = (p: Plan) => {
    setPayTarget(p);
    const defaultBank = banks.find(b => b.is_default);
    payForm.setFieldsValue({
      actual_date: dayjs(),
      bank_account_id: p.bank_account_id || defaultBank?.id,
      remark: p.remark || '',
    });
    setPayOpen(true);
  };

  const submitPay = async () => {
    if (!payTarget) return;
    try {
      const v = await payForm.validateFields();
      await request.put(`/receivables/${payTarget.id}`, {
        status: 'paid',
        actual_date: v.actual_date.format('YYYY-MM-DD'),
        bank_account_id: v.bank_account_id || null,
        remark: v.remark || '',
      });
      message.success('已标记为已收');
      setPayOpen(false); setPayTarget(null);
      fetchAll();
    } catch (e: any) {
      if (e.errorFields) return; // antd 校验错误自己处理
      message.error(e.error || '操作失败');
    }
  };

  // ----- 撤销已收（回到 pending） -----
  const unpay = (p: Plan) => {
    Modal.confirm({
      title: '撤销已收？',
      content: `合同：${p.contract_name}，期次：${p.period}。撤销后状态变回"待收"，但实收日和银行账户信息会保留。`,
      okText: '撤销',
      okType: 'danger',
      onOk: async () => {
        try {
          await request.put(`/receivables/${p.id}`, { status: 'pending', actual_date: null });
          message.success('已撤销');
          fetchAll();
        } catch (e: any) { message.error(e.error || '操作失败'); }
      },
    });
  };

  // ----- 改备注 -----
  const openRemark = (p: Plan) => {
    setRemarkTarget(p);
    remarkForm.setFieldsValue({ remark: p.remark || '' });
    setRemarkOpen(true);
  };
  const submitRemark = async () => {
    if (!remarkTarget) return;
    try {
      const v = await remarkForm.validateFields();
      await request.put(`/receivables/${remarkTarget.id}`, { remark: v.remark || '' });
      message.success('已保存');
      setRemarkOpen(false); setRemarkTarget(null);
      fetchAll();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.error || '操作失败');
    }
  };

  const columns = [
    {
      title: '客户 / 合同',
      key: 'contract',
      render: (_: any, r: Plan) => (
        <div>
          <strong>{r.customer_name}</strong>
          <div style={{ fontSize: 12, color: '#86868b' }}>{r.contract_name}{r.contract_no ? ` · ${r.contract_no}` : ''}</div>
        </div>
      ),
      width: 220,
      ellipsis: true,
    },
    { title: '期次', dataIndex: 'period', key: 'period', width: 100 },
    {
      title: '应收金额', dataIndex: 'amount', key: 'amount', align: 'right' as const, width: 140,
      render: (v: number) => <strong>{yuanFmt(v)}</strong>,
    },
    {
      title: '应收日', dataIndex: 'due_date', key: 'due_date', width: 110,
      render: (v: string, r: Plan) => {
        if (!v) return <span style={{ color: '#86868b' }}>-</span>;
        const ds = displayStatus(r);
        return <span style={{ color: ds === 'overdue' ? '#FF3B30' : undefined }}>{v}</span>;
      },
    },
    {
      title: '实收日', dataIndex: 'actual_date', key: 'actual_date', width: 110,
      render: (v: string) => v || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '状态', key: 'status', width: 90,
      render: (_: any, r: Plan) => {
        const ds = displayStatus(r);
        const m = STATUS_META[ds];
        return <Tag color={m.color} style={{ border: 'none' }}>{m.label}</Tag>;
      },
    },
    {
      title: '入账账户', dataIndex: 'bank_account_name', key: 'bank', width: 140,
      render: (v: string) => v || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true,
      render: (v: string) => v || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '操作', key: 'action', width: 220, fixed: 'right' as const,
      render: (_: any, r: Plan) => (
        <Space size={0}>
          {r.status !== 'paid' ? (
            <Button type="link" size="small" icon={<CheckCircleOutlined />} onClick={() => openPay(r)} style={{ color: '#34C759' }}>
              标记已收
            </Button>
          ) : (
            <Button type="link" size="small" icon={<RollbackOutlined />} onClick={() => unpay(r)} style={{ color: '#FF9500' }}>
              撤销
            </Button>
          )}
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openRemark(r)}>
            备注
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: '#1d1d1f' }}>
          <InboxOutlined style={{ marginRight: 8, color: '#34C759' }} />
          应收账款
        </h2>
        <p style={{ margin: '4px 0 0', color: '#86868b', fontSize: 13 }}>
          管理 active 合同的分期收款。标记已收会同步到合同详情和报表。
        </p>
      </div>

      {/* 统计卡 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}>
          <Card styles={{ body: { padding: 16 } }}>
            <Statistic title="累计应收" value={stats.total} precision={2} prefix="¥" />
            <div style={{ fontSize: 12, color: '#86868b', marginTop: 4 }}>{list.length} 期</div>
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card styles={{ body: { padding: 16 } }} style={{ borderLeft: '4px solid #34C759' }}>
            <Statistic title="已收金额" value={stats.received} precision={2} prefix="¥" valueStyle={{ color: '#34C759' }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card styles={{ body: { padding: 16 } }} style={{ borderLeft: '4px solid #FF9500' }}>
            <Statistic title="未收金额" value={stats.outstanding} precision={2} prefix="¥" valueStyle={{ color: '#FF9500' }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card styles={{ body: { padding: 16 } }} style={{ borderLeft: '4px solid #FF3B30' }}>
            <Statistic title="其中逾期" value={stats.overdue} precision={2} prefix="¥" valueStyle={{ color: '#FF3B30' }} />
          </Card>
        </Col>
      </Row>

      {/* 列表 */}
      <Card
        styles={{ body: { padding: '8px 0 0' } }}
        title={
          <Space wrap>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 130 }}
              options={[
                { value: '', label: '全部状态' },
                { value: 'pending', label: '待收' },
                { value: 'overdue', label: '仅逾期' },
                { value: 'paid', label: '已收' },
              ]}
            />
            <Select
              value={customerFilter}
              onChange={setCustomerFilter}
              style={{ width: 200 }}
              showSearch
              optionFilterProp="label"
              allowClear
              placeholder="按客户筛选"
              options={[{ value: '', label: '全部客户' }, ...customers.map(c => ({ value: c.id, label: c.name }))]}
            />
            <Input
              placeholder="合同名 / 客户 / 期次"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={fetchAll}
              suffix={<Tooltip title="回车搜索"><SearchOutlined style={{ color: '#86868b' }} /></Tooltip>}
              style={{ width: 220 }}
              allowClear
            />
            <Button onClick={fetchAll}>刷新</Button>
          </Space>
        }
      >
        <Table
          columns={columns as any}
          dataSource={list}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 期` }}
          scroll={{ x: 1300 }}
          locale={{ emptyText: '无符合条件的收款计划' }}
        />
      </Card>

      {/* 标记已收弹窗 */}
      <Modal
        title="登记收款"
        open={payOpen}
        onCancel={() => { setPayOpen(false); setPayTarget(null); }}
        onOk={submitPay}
        okText="确认收款"
        width={500}
        okButtonProps={{
          icon: <CheckCircleOutlined />,
          style: { borderRadius: 10, background: 'linear-gradient(135deg, #34C759, #5AC8FA)', border: 'none' },
        }}
      >
        {payTarget && (
          <div style={{ marginBottom: 12, padding: 12, background: '#fafafb', borderRadius: 8, fontSize: 13 }}>
            <div><strong>{payTarget.customer_name}</strong> · {payTarget.contract_name}</div>
            <div style={{ color: '#86868b', marginTop: 4 }}>
              {payTarget.period} · 应收 <strong style={{ color: '#1d1d1f' }}>{yuanFmt(payTarget.amount)}</strong>
              {payTarget.due_date && <span> · 应收日 {payTarget.due_date}</span>}
            </div>
          </div>
        )}
        <Form form={payForm} layout="vertical">
          <Form.Item name="actual_date" label="实收日期" rules={[{ required: true, message: '请选择实收日期' }]}>
            <DatePicker style={{ width: '100%', borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="bank_account_id" label="入账银行账户">
            <Select placeholder="选择银行账户" allowClear style={{ borderRadius: 10 }}>
              {banks.filter(b => b.status === 'active').map(b => (
                <Select.Option key={b.id} value={b.id}>
                  {b.name}{b.bank_name ? ` · ${b.bank_name}` : ''}{b.is_default ? ' (默认)' : ''}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="可选，如：转账水单号 / 实收差异说明" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 备注弹窗 */}
      <Modal
        title="编辑备注"
        open={remarkOpen}
        onCancel={() => { setRemarkOpen(false); setRemarkTarget(null); }}
        onOk={submitRemark}
        width={450}
      >
        <Form form={remarkForm} layout="vertical">
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={4} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Receivables;
