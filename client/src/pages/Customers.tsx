import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Space, Card, Tag, Popconfirm, message, Descriptions, Progress, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ImportOutlined, PrinterOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import request from '../utils/request';
import ImportExportModal from '../components/ImportExportModal';

const LEVEL_MAP: Record<string, { color: string; label: string }> = {
  gold: { color: '#FFC53D', label: '🥇 黄金客户' },
  silver: { color: '#86868b', label: '🥈 白银客户' },
  normal: { color: '#5AC8FA', label: '普通' },
  restricted: { color: '#FF3B30', label: '受限' },
};

const yuanFmt = (n: number) => `¥${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Customers: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [keyword, setKeyword] = useState('');
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditData, setCreditData] = useState<any>(null);
  const [creditCustomer, setCreditCustomer] = useState<any>(null);
  const [form] = Form.useForm();

  const fetchCustomers = async (kw = '') => {
    setLoading(true);
    try {
      const data: any = await request.get('/customers', { params: { keyword: kw } });
      setCustomers(data);
    } catch (err: any) {
      message.error(err.error || '获取失败');
    }
    setLoading(false);
  };

  useEffect(() => { fetchCustomers(); }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editItem) {
        await request.put(`/customers/${editItem.id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/customers', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditItem(null);
      fetchCustomers(keyword);
    } catch (err: any) {
      message.error(err.error || '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/customers/${id}`);
      message.success('删除成功');
      fetchCustomers(keyword);
    } catch (err: any) {
      message.error(err.error || '删除失败');
    }
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    form.setFieldsValue({ level: 'normal', credit_limit: 0, payment_terms_days: 0, ...item });
    setModalOpen(true);
  };

  const openCredit = async (item: any) => {
    setCreditCustomer(item);
    setCreditOpen(true);
    setCreditData(null);
    try {
      const data: any = await request.get(`/customers/${item.id}/credit-status`);
      setCreditData(data);
    } catch (err: any) {
      message.error(err.error || '加载信用状态失败');
    }
  };

  const openCreate = () => {
    setEditItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    { title: '客户名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    {
      title: '分级', dataIndex: 'level', key: 'level', width: 110,
      render: (v: string) => {
        const m = LEVEL_MAP[v || 'normal'];
        return <Tag color={m.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{m.label}</Tag>;
      },
    },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    {
      title: '信用额度', dataIndex: 'credit_limit', key: 'credit_limit', width: 120,
      render: (v: number) => v > 0 ? yuanFmt(v) : <span style={{ color: '#86868b' }}>-</span>,
    },
    {
      title: '账期', dataIndex: 'payment_terms_days', key: 'pt', width: 80,
      render: (v: number) => v > 0 ? <span>{v} 天</span> : <span style={{ color: '#86868b' }}>-</span>,
    },
    { title: '行业', dataIndex: 'industry', key: 'industry', render: (v: string) => v ? <Tag style={{ borderRadius: 6, padding: '2px 10px', border: 'none', background: '#f5f5f7' }}>{v}</Tag> : '-' },
    { title: '合同数', dataIndex: 'contract_count', key: 'contract_count', width: 80, render: (v: number) => <Tag color="#007AFF" style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{v || 0}</Tag> },
    {
      title: '操作', key: 'action', width: 260, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" icon={<SafetyCertificateOutlined />} onClick={() => openCredit(record)} style={{ color: '#34C759' }}>信用</Button>
          <Button type="link" size="small" icon={<PrinterOutlined />} onClick={() => window.open(`/api/print/statement/${record.id}`, '_blank')} style={{ color: '#007AFF' }}>对账单</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ color: '#007AFF' }}>编辑</Button>
          <Popconfirm title="确定删除此客户？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>客户管理</span>}
        style={{ borderRadius: 16, border: '1px solid rgba(0,0,0,0.04)' }}
        bordered={false}
        extra={
          <Space>
            <Input.Search
              placeholder="搜索客户名称/联系人"
              allowClear
              onSearch={(v) => { setKeyword(v); fetchCustomers(v); }}
              style={{ width: 240, borderRadius: 10 }}
            />
            <Button
              icon={<ImportOutlined />}
              onClick={() => setImportExportOpen(true)}
              style={{ borderRadius: 10 }}
            >
              导入/导出
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreate}
              style={{ borderRadius: 10, height: 38, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' }}
            >
              新增客户
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={customers}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          style={{ borderRadius: 12 }}
          scroll={{ x: 1200 }}
        />
      </Card>

      <Modal
        title={editItem ? '编辑客户' : '新增客户'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditItem(null); }}
        width={600}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="客户名称" rules={[{ required: true, message: '请输入客户名称' }]}>
            <Input placeholder="请输入客户名称" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="contact_person" label="联系人">
            <Input placeholder="请输入联系人" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="请输入电话" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="请输入邮箱" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="industry" label="行业">
            <Select placeholder="请选择行业" allowClear style={{ borderRadius: 10 }}>
              {['互联网/IT', '金融', '制造业', '教育', '医疗', '房地产', '零售', '政府', '其他'].map(i => <Select.Option key={i} value={i}>{i}</Select.Option>)}
            </Select>
          </Form.Item>
          <Space style={{ width: '100%', display: 'flex' }} size="large">
            <Form.Item name="level" label="客户分级" initialValue="normal" style={{ flex: 1 }}>
              <Select style={{ borderRadius: 10 }}>
                <Select.Option value="gold">🥇 黄金客户</Select.Option>
                <Select.Option value="silver">🥈 白银客户</Select.Option>
                <Select.Option value="normal">普通</Select.Option>
                <Select.Option value="restricted">受限（合同提示风险）</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="credit_limit" label="信用额度" initialValue={0} style={{ flex: 1 }} tooltip="0 表示不限额；超过此额度时合同/付款计划页面会给提示">
              <InputNumber style={{ width: '100%', borderRadius: 10 }} min={0} precision={2} addonAfter="元" />
            </Form.Item>
            <Form.Item name="payment_terms_days" label="账期" initialValue={0} style={{ flex: 1 }} tooltip="结算天数（净 N 天），0 表示无账期">
              <InputNumber style={{ width: '100%', borderRadius: 10 }} min={0} precision={0} addonAfter="天" />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="地址">
            <Input placeholder="请输入地址" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" style={{ borderRadius: 10 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 信用状态弹窗 */}
      <Modal
        title={<span><SafetyCertificateOutlined style={{ color: '#34C759', marginRight: 8 }} />{creditCustomer?.name} · 信用状态</span>}
        open={creditOpen}
        onCancel={() => { setCreditOpen(false); setCreditCustomer(null); setCreditData(null); }}
        footer={<Button onClick={() => setCreditOpen(false)} style={{ borderRadius: 10 }}>关闭</Button>}
        width={620}
      >
        {!creditData ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#86868b' }}>加载中...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {creditData.over_limit && (
              <Alert
                type="error"
                showIcon
                message="已超出信用额度"
                description={`已用 ${yuanFmt(creditData.used)}，超出额度 ${yuanFmt(creditData.used - creditData.credit_limit)}。建议暂停新增订单或催收。`}
              />
            )}
            {creditData.has_overdue && (
              <Alert
                type="warning"
                showIcon
                message="存在逾期未收款"
                description={`逾期金额 ${yuanFmt(creditData.overdue)}`}
              />
            )}
            <Descriptions bordered column={2} size="small" labelStyle={{ background: '#fafafb', width: 110 }}>
              <Descriptions.Item label="客户分级">
                <Tag color={LEVEL_MAP[creditData.level].color} style={{ border: 'none' }}>{LEVEL_MAP[creditData.level].label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="账期">{creditData.payment_terms_days > 0 ? `${creditData.payment_terms_days} 天` : '无'}</Descriptions.Item>
              <Descriptions.Item label="信用额度">{creditData.credit_limit > 0 ? yuanFmt(creditData.credit_limit) : '不限'}</Descriptions.Item>
              <Descriptions.Item label="已用额度">
                <strong style={{ color: creditData.over_limit ? '#FF3B30' : '#1d1d1f' }}>{yuanFmt(creditData.used)}</strong>
              </Descriptions.Item>
              <Descriptions.Item label="可用余额" span={2}>
                <span style={{ color: creditData.credit_limit > 0 ? (creditData.available > 0 ? '#34C759' : '#FF3B30') : '#86868b' }}>
                  {creditData.credit_limit > 0 ? yuanFmt(creditData.available) : '不限'}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="历史回款">{yuanFmt(creditData.paid_total)}</Descriptions.Item>
              <Descriptions.Item label="历史成交">{yuanFmt(creditData.plan_total)}</Descriptions.Item>
            </Descriptions>
            {creditData.usage_rate !== null && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#86868b', fontSize: 12 }}>额度使用率</span>
                  <strong style={{ color: creditData.usage_rate > 100 ? '#FF3B30' : creditData.usage_rate > 80 ? '#FF9500' : '#34C759' }}>
                    {creditData.usage_rate}%
                  </strong>
                </div>
                <Progress
                  percent={Math.min(creditData.usage_rate, 100)}
                  strokeColor={creditData.usage_rate > 100 ? '#FF3B30' : creditData.usage_rate > 80 ? '#FF9500' : '#34C759'}
                  showInfo={false}
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      <ImportExportModal
        visible={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        module="customers"
        moduleName="客户"
        onImportSuccess={() => fetchCustomers(keyword)}
      />
    </div>
  );
};

export default Customers;
