import React, { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, DatePicker, Space, Card, Tag, Popconfirm,
  message, Tabs, Descriptions, Divider, Statistic, Row, Col
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
  CheckOutlined, CloseOutlined, DollarOutlined,
} from '@ant-design/icons';
import request from '../utils/request';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import Attachments from '../components/Attachments';

const yuan = (n: number) => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, { color: string; label: string }> = {
  submitted: { color: '#FF9500', label: '待审批' },
  approved:  { color: '#5AC8FA', label: '已批准·待付款' },
  paid:      { color: '#34C759', label: '已付款' },
  rejected:  { color: '#FF3B30', label: '已驳回' },
};
const CATEGORY: Record<string, string> = {
  travel: '差旅', meal: '招待餐饮', office: '办公用品',
  training: '培训学习', transportation: '交通', other: '其它',
};

const Reimbursements: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const isFinance = isAdmin || user?.role === 'finance';

  const [tab, setTab] = useState<'mine' | 'pending' | 'all'>(isFinance ? 'pending' : 'mine');
  const [list, setList] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rejectRemark, setRejectRemark] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<any>(null);
  const [payBankId, setPayBankId] = useState<string | undefined>(undefined);
  const [form] = Form.useForm();

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (tab === 'mine') params.mine = true;
      if (tab === 'pending') params.status = 'submitted';
      const data: any = await request.get('/reimbursements', { params });
      setList(data);
    } catch (e: any) { message.error(e.error || '加载失败'); }
    setLoading(false);
  };
  const fetchBanks = async () => {
    try { const d: any = await request.get('/bank-accounts'); setBankAccounts(d); } catch {}
  };
  useEffect(() => { fetchBanks(); }, []);
  useEffect(() => { fetchList(); }, [tab]);

  const openCreate = () => {
    setEditItem(null);
    form.resetFields();
    form.setFieldsValue({ category: 'other', occurred_date: dayjs() });
    setModalOpen(true);
  };
  const openEdit = (item: any) => {
    setEditItem(item);
    form.setFieldsValue({
      ...item,
      occurred_date: item.occurred_date ? dayjs(item.occurred_date) : undefined,
    });
    setModalOpen(true);
  };
  const openDetail = async (item: any) => {
    try {
      const d: any = await request.get(`/reimbursements/${item.id}`);
      setDetail(d); setDetailOpen(true);
    } catch (e: any) { message.error(e.error || '加载失败'); }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      occurred_date: values.occurred_date?.format('YYYY-MM-DD'),
    };
    try {
      if (editItem) {
        await request.put(`/reimbursements/${editItem.id}`, payload);
        message.success('已更新');
      } else {
        await request.post('/reimbursements', payload);
        message.success('已提交');
      }
      setModalOpen(false);
      fetchList();
    } catch (e: any) { message.error(e.error || '操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try { await request.delete(`/reimbursements/${id}`); message.success('已删除'); fetchList(); }
    catch (e: any) { message.error(e.error || '删除失败'); }
  };

  const handleApprove = async (item: any) => {
    try { await request.post(`/reimbursements/${item.id}/approve`); message.success('审批通过'); fetchList(); if (detailOpen) openDetail(item); }
    catch (e: any) { message.error(e.error || '操作失败'); }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    try {
      await request.post(`/reimbursements/${rejectTarget.id}/reject`, { remark: rejectRemark });
      message.success('已驳回');
      setRejectOpen(false); setRejectRemark(''); setRejectTarget(null);
      fetchList();
    } catch (e: any) { message.error(e.error || '操作失败'); }
  };

  const handleMarkPaid = async () => {
    if (!payTarget) return;
    try {
      await request.post(`/reimbursements/${payTarget.id}/mark-paid`, { bank_account_id: payBankId || null });
      message.success('已标记付款');
      setPayOpen(false); setPayBankId(undefined); setPayTarget(null);
      fetchList();
    } catch (e: any) { message.error(e.error || '操作失败'); }
  };

  // 统计
  const submittedTotal = list.filter(x => x.status === 'submitted').reduce((s, r) => s + (r.amount || 0), 0);
  const approvedTotal = list.filter(x => x.status === 'approved').reduce((s, r) => s + (r.amount || 0), 0);
  const paidTotal = list.filter(x => x.status === 'paid').reduce((s, r) => s + (r.amount || 0), 0);

  const columns = [
    { title: '摘要', dataIndex: 'title', key: 'title', render: (v: string) => <strong>{v}</strong> },
    { title: '类别', dataIndex: 'category', key: 'category', width: 100, render: (v: string) => CATEGORY[v] || v },
    { title: '金额', dataIndex: 'amount', key: 'amount', align: 'right' as const, width: 130, render: (v: number) => yuan(v) },
    { title: '发生日期', dataIndex: 'occurred_date', key: 'occurred_date', width: 110 },
    { title: '申请人', dataIndex: 'applicant_real_name', key: 'applicant', width: 110,
      render: (_: any, r: any) => r.applicant_real_name || r.applicant_name },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 130,
      render: (v: string) => {
        const s = STATUS[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, border: 'none' }}>{s.label}</Tag>;
      },
    },
    { title: '提交时间', dataIndex: 'created_at', key: 'created_at', width: 160 },
    {
      title: '操作', key: 'action', width: 320,
      render: (_: any, r: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)}>详情</Button>
          {r.status === 'submitted' && r.applicant_id === user?.id && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          )}
          {isFinance && r.status === 'submitted' && (
            <>
              <Button type="link" size="small" icon={<CheckOutlined />} style={{ color: '#34C759' }} onClick={() => handleApprove(r)}>通过</Button>
              <Button type="link" size="small" icon={<CloseOutlined />} danger onClick={() => { setRejectTarget(r); setRejectOpen(true); }}>驳回</Button>
            </>
          )}
          {isFinance && r.status === 'approved' && (
            <Button type="link" size="small" icon={<DollarOutlined />} style={{ color: '#007AFF' }}
              onClick={() => {
                setPayTarget(r);
                const def = bankAccounts.find(b => b.is_default && b.status === 'active');
                setPayBankId(def?.id);
                setPayOpen(true);
              }}>
              标记已付
            </Button>
          )}
          {['submitted', 'rejected'].includes(r.status) && (r.applicant_id === user?.id || isAdmin) && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Row gutter={16}>
        <Col xs={24} sm={8}><Card><Statistic title="待审批 / 当前列表" value={submittedTotal} precision={2} prefix="¥" valueStyle={{ color: '#FF9500' }} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="待付款 / 当前列表" value={approvedTotal} precision={2} prefix="¥" valueStyle={{ color: '#5AC8FA' }} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="已付款 / 当前列表" value={paidTotal} precision={2} prefix="¥" valueStyle={{ color: '#34C759' }} /></Card></Col>
      </Row>

      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600 }}>费用报销</span>}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建报销单</Button>}
        styles={{ body: { padding: 0 } }}
      >
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as any)}
          tabBarStyle={{ padding: '0 24px', marginBottom: 0 }}
          items={[
            ...(isFinance ? [{ key: 'pending', label: '待我审批' }] : []),
            { key: 'mine', label: '我的报销' },
            ...(isFinance ? [{ key: 'all', label: '全部报销单' }] : []),
          ]}
        />
        <Table
          columns={columns as any}
          dataSource={list}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1300 }}
        />
      </Card>

      {/* 新建/编辑 modal */}
      <Modal
        title={editItem ? '编辑报销单' : '新建报销单'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={540}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="摘要" rules={[{ required: true, message: '请填写' }]}>
            <Input placeholder="如：5/10-5/12 出差北京（客户拜访）" />
          </Form.Item>
          <Form.Item name="category" label="类别" initialValue="other">
            <Select>
              {Object.entries(CATEGORY).map(([k, v]) => <Select.Option key={k} value={k}>{v}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="amount" label="金额（元）" rules={[{ required: true, message: '请填写金额' }]}>
            <InputNumber style={{ width: '100%' }} min={0} precision={2} addonAfter="元" />
          </Form.Item>
          <Form.Item name="occurred_date" label="发生日期">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="详细说明">
            <Input.TextArea rows={3} placeholder="必要时附上发票、收据等附件" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情 modal */}
      <Modal
        title="报销单详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={680}
      >
        {detail && (
          <div>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="摘要" span={2}>{detail.title}</Descriptions.Item>
              <Descriptions.Item label="类别">{CATEGORY[detail.category] || detail.category}</Descriptions.Item>
              <Descriptions.Item label="金额">{yuan(detail.amount)}</Descriptions.Item>
              <Descriptions.Item label="发生日期">{detail.occurred_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS[detail.status]?.color} style={{ borderRadius: 6, border: 'none' }}>
                  {STATUS[detail.status]?.label || detail.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="申请人">{detail.applicant_real_name || detail.applicant_name}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{detail.created_at}</Descriptions.Item>
              {detail.approved_at && (
                <>
                  <Descriptions.Item label="审批人">{detail.approved_by_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="审批时间">{detail.approved_at}</Descriptions.Item>
                </>
              )}
              {detail.status === 'rejected' && (
                <Descriptions.Item label="驳回理由" span={2}>
                  <span style={{ color: '#FF3B30' }}>{detail.approval_remark || '-'}</span>
                </Descriptions.Item>
              )}
              {detail.paid_at && (
                <>
                  <Descriptions.Item label="付款人">{detail.paid_by_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="付款时间">{detail.paid_at}</Descriptions.Item>
                  <Descriptions.Item label="付款账户" span={2}>{detail.bank_account_name || '未指定'}</Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="详细说明" span={2}>{detail.description || '-'}</Descriptions.Item>
            </Descriptions>

            <Divider titlePlacement="left" style={{ fontSize: 14, fontWeight: 600 }}>报销凭证（发票/收据）</Divider>
            <Attachments entity="reimbursements" entityId={detail.id}
              readOnly={detail.applicant_id !== user?.id && !isFinance}
            />
          </div>
        )}
      </Modal>

      {/* 驳回 */}
      <Modal
        title="驳回报销"
        open={rejectOpen}
        onOk={handleReject}
        onCancel={() => { setRejectOpen(false); setRejectRemark(''); setRejectTarget(null); }}
        okText="确认驳回" okButtonProps={{ danger: true, disabled: !rejectRemark.trim() }}
      >
        <Input.TextArea rows={3} placeholder="请填写驳回理由（必填）"
          value={rejectRemark} onChange={(e) => setRejectRemark(e.target.value)} />
      </Modal>

      {/* 标记付款 */}
      <Modal
        title="标记报销已付款"
        open={payOpen}
        onOk={handleMarkPaid}
        onCancel={() => { setPayOpen(false); setPayTarget(null); setPayBankId(undefined); }}
        okText="确认已付"
      >
        <Form layout="vertical">
          <Form.Item label="付款账户（可选）">
            <Select placeholder="不选则不关联任何账户" allowClear value={payBankId} onChange={setPayBankId}>
              {bankAccounts.filter(b => b.status === 'active').map(b => (
                <Select.Option key={b.id} value={b.id}>
                  {b.name} {b.is_default ? '（默认）' : ''}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          {payTarget && <p>金额：<strong>{yuan(payTarget.amount)}</strong>，付给：<strong>{payTarget.applicant_real_name || payTarget.applicant_name}</strong></p>}
        </Form>
      </Modal>
    </div>
  );
};

export default Reimbursements;
