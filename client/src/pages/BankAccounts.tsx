import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Card, Tag, Popconfirm, message, Switch, Statistic, Row, Col, Empty } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, BankOutlined } from '@ant-design/icons';
import request from '../utils/request';
import { useAuth } from '../contexts/AuthContext';

const yuan = (n: number) => `¥${(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BankAccounts: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const canManage = isAdmin || user?.role === 'finance';
  const [list, setList] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form] = Form.useForm();

  const fetchList = async () => {
    setLoading(true);
    try {
      const [data, bal] = await Promise.all([
        request.get('/bank-accounts'),
        request.get('/bank-accounts/_/balance'),
      ]);
      setList(data as any);
      setBalances(bal as any);
    } catch { message.error('加载失败'); }
    setLoading(false);
  };
  useEffect(() => { fetchList(); }, []);

  const openCreate = () => {
    setEditItem(null);
    form.resetFields();
    form.setFieldsValue({ currency: 'CNY', status: 'active', is_default: false });
    setModalOpen(true);
  };
  const openEdit = (item: any) => {
    setEditItem(item);
    form.setFieldsValue({ ...item, is_default: !!item.is_default });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editItem) {
        await request.put(`/bank-accounts/${editItem.id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/bank-accounts', values);
        message.success('已创建');
      }
      setModalOpen(false);
      fetchList();
    } catch (e: any) { message.error(e.error || '操作失败'); }
  };
  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/bank-accounts/${id}`);
      message.success('已删除');
      fetchList();
    } catch (e: any) { message.error(e.error || '删除失败'); }
  };

  const totalReceived = balances.reduce((s, b) => s + (b.received || 0), 0);
  const totalPaid = balances.reduce((s, b) => s + (b.paid || 0), 0);
  const totalBalance = balances.reduce((s, b) => s + (b.balance || 0), 0);

  const columns = [
    {
      title: '账户名', dataIndex: 'name', key: 'name',
      render: (v: string, r: any) => (
        <span>
          <strong>{v}</strong>
          {r.is_default ? <Tag color="#007AFF" style={{ marginLeft: 8, borderRadius: 6 }}>默认</Tag> : null}
          {r.status === 'inactive' ? <Tag color="#86868b" style={{ marginLeft: 8, borderRadius: 6 }}>停用</Tag> : null}
        </span>
      ),
    },
    { title: '开户行', dataIndex: 'bank_name', key: 'bank_name', render: (v: string) => v || '-' },
    { title: '账号', dataIndex: 'account_number', key: 'account_number', render: (v: string) => v || '-' },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 80 },
    {
      title: '余额（已收 - 已付）', key: 'balance', width: 200, align: 'right' as const,
      render: (_: any, r: any) => {
        const b = balances.find(x => x.id === r.id);
        if (!b) return '-';
        return <strong style={{ color: b.balance >= 0 ? '#34C759' : '#FF3B30' }}>{yuan(b.balance)}</strong>;
      },
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true, render: (v: string) => v || '-' },
    ...(canManage ? [{
      title: '操作', key: 'action', width: 160,
      render: (_: any, record: any) => (
        <span>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </span>
      ),
    }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Row gutter={16}>
        <Col xs={24} sm={8}>
          <Card><Statistic title="所有账户累计收款" value={totalReceived} precision={2} prefix="¥" valueStyle={{ color: '#34C759' }} /></Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card><Statistic title="所有账户累计付款" value={totalPaid} precision={2} prefix="¥" valueStyle={{ color: '#FF3B30' }} /></Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card><Statistic title="净余额" value={totalBalance} precision={2} prefix="¥" valueStyle={{ color: totalBalance >= 0 ? '#34C759' : '#FF3B30' }} /></Card>
        </Col>
      </Row>

      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600 }}><BankOutlined /> 银行账户</span>}
        extra={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增账户</Button> : null}
        styles={{ body: { padding: '8px 0 0' } }}
      >
        <Table
          columns={columns as any}
          dataSource={list}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: <Empty description="还没有银行账户，新增一个再开始记账吧" /> }}
        />
      </Card>

      <Modal
        title={editItem ? '编辑银行账户' : '新增银行账户'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="账户名 / 别名" rules={[{ required: true, message: '请输入账户名' }]}>
            <Input placeholder="如：公账主户 / 备用金 / 支付宝商家" />
          </Form.Item>
          <Form.Item name="bank_name" label="开户行">
            <Input placeholder="如：招商银行上海分行" />
          </Form.Item>
          <Form.Item name="account_number" label="账号">
            <Input placeholder="6222 XXXX XXXX XXXX" />
          </Form.Item>
          <Form.Item name="currency" label="币种" initialValue="CNY">
            <Select>
              <Select.Option value="CNY">人民币 CNY</Select.Option>
              <Select.Option value="USD">美元 USD</Select.Option>
              <Select.Option value="EUR">欧元 EUR</Select.Option>
              <Select.Option value="HKD">港币 HKD</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="is_default" label="设为默认账户" valuePropName="checked"
            tooltip="设为默认后，同币种内只保留这一个默认；收付款表单会自动填充">
            <Switch />
          </Form.Item>
          {editItem && (
            <Form.Item name="status" label="状态" initialValue="active">
              <Select>
                <Select.Option value="active">启用中</Select.Option>
                <Select.Option value="inactive">停用</Select.Option>
              </Select>
            </Form.Item>
          )}
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default BankAccounts;
