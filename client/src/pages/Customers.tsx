import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Card, Tag, Popconfirm, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ImportOutlined } from '@ant-design/icons';
import request from '../utils/request';
import ImportExportModal from '../components/ImportExportModal';

const Customers: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [keyword, setKeyword] = useState('');
  const [importExportOpen, setImportExportOpen] = useState(false);
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
    form.setFieldsValue(item);
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    { title: '客户名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact_person' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '行业', dataIndex: 'industry', key: 'industry', render: (v: string) => v ? <Tag style={{ borderRadius: 6, padding: '2px 10px', border: 'none', background: '#f5f5f7' }}>{v}</Tag> : '-' },
    { title: '合同数', dataIndex: 'contract_count', key: 'contract_count', render: (v: number) => <Tag color="#007AFF" style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{v || 0}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作', key: 'action', width: 150,
      render: (_: any, record: any) => (
        <Space>
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
          <Form.Item name="address" label="地址">
            <Input placeholder="请输入地址" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注" style={{ borderRadius: 10 }} />
          </Form.Item>
        </Form>
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
