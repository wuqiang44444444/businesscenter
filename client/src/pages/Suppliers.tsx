import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Card, Tag, Popconfirm, message, Statistic, Row, Col } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, BankOutlined, ImportOutlined } from '@ant-design/icons';
import request from '../utils/request';
import ImportExportModal from '../components/ImportExportModal';

const Suppliers: React.FC = () => {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [keyword, setKeyword] = useState('');
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchSuppliers = async (kw = '') => {
    setLoading(true);
    try { const data: any = await request.get('/suppliers', { params: { keyword: kw } }); setSuppliers(data); }
    catch { message.error('获取失败'); }
    setLoading(false);
  };

  useEffect(() => { fetchSuppliers(); }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editItem) {
        await request.put(`/suppliers/${editItem.id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/suppliers', values);
        message.success('创建成功');
      }
      setModalOpen(false); form.resetFields(); setEditItem(null); fetchSuppliers(keyword);
    } catch (err: any) { message.error(err.error || '操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try { await request.delete(`/suppliers/${id}`); message.success('删除成功'); fetchSuppliers(keyword); }
    catch (err: any) { message.error(err.error || '删除失败'); }
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    form.setFieldsValue(item);
    setModalOpen(true);
  };

  const totalPayable = suppliers.reduce((s: number, c: any) => s + (c.total_payable || 0), 0);
  const totalPaid = suppliers.reduce((s: number, c: any) => s + (c.total_paid || 0), 0);

  const columns = [
    { title: '供应商名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}><BankOutlined style={{ marginRight: 6, color: '#007AFF' }} />{v}</strong> },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '分类', dataIndex: 'category', key: 'category', render: (v: string) => v ? <Tag style={{ borderRadius: 6, padding: '2px 10px', border: 'none', background: '#f5f5f7' }}>{v}</Tag> : '-' },
    {
      title: '应付总额', dataIndex: 'total_payable', key: 'total_payable', align: 'right' as const,
      render: (v: number) => <span style={{ color: '#007AFF', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span>
    },
    {
      title: '已付总额', dataIndex: 'total_paid', key: 'total_paid', align: 'right' as const,
      render: (v: number) => <span style={{ color: '#34C759', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span>
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'active' ? '#34C759' : '#86868b'} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{v === 'active' ? '正常' : '停用'}</Tag>
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 140 },
    {
      title: '操作', key: 'action', width: 150,
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ color: '#007AFF' }}>编辑</Button>
          <Popconfirm title="确定删除此供应商？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const statCardStyle = {
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.04)',
    background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.7))',
  };

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={8}>
          <Card hoverable style={statCardStyle}>
            <Statistic
              title="供应商总数"
              value={suppliers.length}
              prefix={<BankOutlined style={{ color: '#007AFF' }} />}
              valueStyle={{ color: '#1d1d1f', fontSize: 28, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card hoverable style={statCardStyle}>
            <Statistic
              title="应付总额"
              value={totalPayable}
              prefix="¥"
              valueStyle={{ color: '#007AFF', fontSize: 28, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card hoverable style={statCardStyle}>
            <Statistic
              title="已付总额"
              value={totalPaid}
              prefix="¥"
              valueStyle={{ color: '#34C759', fontSize: 28, fontWeight: 600 }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>供应商管理</span>}
        style={{ borderRadius: 16, border: '1px solid rgba(0,0,0,0.04)' }}
        bordered={false}
        extra={
          <Space>
            <Input.Search
              placeholder="搜索供应商名称/联系人"
              allowClear
              onSearch={(v) => { setKeyword(v); fetchSuppliers(v); }}
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
              onClick={() => { setEditItem(null); form.resetFields(); setModalOpen(true); }}
              style={{ borderRadius: 10, height: 38, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' }}
            >
              新增供应商
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={suppliers}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          style={{ borderRadius: 12 }}
        />
      </Card>

      <Modal
        title={editItem ? '编辑供应商' : '新增供应商'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditItem(null); }}
        width={620}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input placeholder="请输入供应商名称" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="contact_person" label="联系人"><Input placeholder="请输入联系人" style={{ width: 200, borderRadius: 10 }} /></Form.Item>
            <Form.Item name="phone" label="电话"><Input placeholder="请输入电话" style={{ width: 200, borderRadius: 10 }} /></Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="email" label="邮箱"><Input placeholder="请输入邮箱" style={{ width: 200, borderRadius: 10 }} /></Form.Item>
            <Form.Item name="category" label="分类">
              <Select placeholder="请选择分类" allowClear style={{ width: 200, borderRadius: 10 }}>
                {['技术服务', '硬件设备', '软件开发', '咨询顾问', '物资采购', '人力资源', '物流运输', '其他'].map(i => <Select.Option key={i} value={i}>{i}</Select.Option>)}
              </Select>
            </Form.Item>
          </Space>
          <Form.Item name="address" label="地址"><Input placeholder="请输入地址" style={{ borderRadius: 10 }} /></Form.Item>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="bank_name" label="开户银行"><Input placeholder="开户银行" style={{ width: 240, borderRadius: 10 }} /></Form.Item>
            <Form.Item name="bank_account" label="银行账号"><Input placeholder="银行账号" style={{ width: 240, borderRadius: 10 }} /></Form.Item>
          </Space>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select style={{ width: 160, borderRadius: 10 }}>
              <Select.Option value="active">正常</Select.Option>
              <Select.Option value="disabled">停用</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={3} placeholder="请输入备注" style={{ borderRadius: 10 }} /></Form.Item>
        </Form>
      </Modal>

      <ImportExportModal
        visible={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        module="suppliers"
        moduleName="供应商"
        onImportSuccess={() => fetchSuppliers(keyword)}
      />
    </div>
  );
};

export default Suppliers;
