import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Card, Tag, Popconfirm, message, InputNumber, DatePicker } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ImportOutlined } from '@ant-design/icons';
import request from '../utils/request';
import dayjs from 'dayjs';
import ImportExportModal from '../components/ImportExportModal';

const Projects: React.FC = () => {
  const [projects, setProjects] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const data: any = await request.get('/projects');
      setProjects(data);
    } catch (err: any) {
      message.error(err.error || '获取失败');
    }
    setLoading(false);
  };

  const fetchCustomers = async () => {
    const data: any = await request.get('/customers');
    setCustomers(data);
  };

  useEffect(() => { fetchProjects(); fetchCustomers(); }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      start_date: values.date_range?.[0]?.format('YYYY-MM-DD'),
      end_date: values.date_range?.[1]?.format('YYYY-MM-DD'),
      budget: values.budget || 0,
    };
    try {
      if (editItem) {
        await request.put(`/projects/${editItem.id}`, payload);
        message.success('更新成功');
      } else {
        await request.post('/projects', payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditItem(null);
      fetchProjects();
    } catch (err: any) {
      message.error(err.error || '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/projects/${id}`);
      message.success('删除成功');
      fetchProjects();
    } catch (err: any) {
      message.error(err.error || '删除失败');
    }
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    form.setFieldsValue({
      ...item,
      date_range: item.start_date && item.end_date ? [dayjs(item.start_date), dayjs(item.end_date)] : undefined,
    });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const statusMap: Record<string, { color: string; label: string }> = {
    active: { color: '#34C759', label: '进行中' },
    completed: { color: '#007AFF', label: '已完成' },
    paused: { color: '#FF9500', label: '暂停' },
    cancelled: { color: '#FF3B30', label: '已取消' },
  };

  const columns = [
    { title: '项目名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '客户', dataIndex: 'customer_name', key: 'customer_name', render: (v: string) => v || '-' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const s = statusMap[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
    { title: '负责人', dataIndex: 'manager', key: 'manager' },
    { title: '预算', dataIndex: 'budget', key: 'budget', render: (v: number) => v ? <span style={{ color: '#007AFF', fontWeight: 500 }}>¥{v.toLocaleString()}</span> : '-' },
    { title: '开始日期', dataIndex: 'start_date', key: 'start_date' },
    { title: '结束日期', dataIndex: 'end_date', key: 'end_date' },
    {
      title: '操作', key: 'action', width: 150,
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ color: '#007AFF' }}>编辑</Button>
          <Popconfirm title="确定删除此项目？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>项目管理</span>}
        style={{ borderRadius: 16, border: '1px solid rgba(0,0,0,0.04)' }}
        bordered={false}
        extra={
          <Space>
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
              新增项目
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={projects}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          style={{ borderRadius: 12 }}
        />
      </Card>

      <Modal
        title={editItem ? '编辑项目' : '新增项目'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditItem(null); }}
        width={640}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="请输入项目名称" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="customer_id" label="关联客户">
            <Select placeholder="请选择客户" allowClear showSearch optionFilterProp="children" style={{ borderRadius: 10 }}>
              {customers.map((c: any) => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="status" label="状态" initialValue="active">
              <Select style={{ width: 160, borderRadius: 10 }}>
                <Select.Option value="active">进行中</Select.Option>
                <Select.Option value="completed">已完成</Select.Option>
                <Select.Option value="paused">暂停</Select.Option>
                <Select.Option value="cancelled">已取消</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="budget" label="预算">
              <InputNumber style={{ width: 160, borderRadius: 10 }} min={0} placeholder="预算金额" addonAfter="元" />
            </Form.Item>
          </Space>
          <Form.Item name="date_range" label="项目周期">
            <DatePicker.RangePicker style={{ width: '100%', borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="manager" label="负责人">
            <Input placeholder="请输入负责人" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={3} placeholder="请输入项目描述" style={{ borderRadius: 10 }} />
          </Form.Item>
        </Form>
      </Modal>

      <ImportExportModal
        visible={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        module="projects"
        moduleName="项目"
        onImportSuccess={() => fetchProjects()}
      />
    </div>
  );
};

export default Projects;
