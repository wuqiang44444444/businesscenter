import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Card, Tag, Popconfirm, message, Checkbox } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import request from '../utils/request';

const permissionOptions = [
  { label: '客户管理', value: 'customers' },
  { label: '项目管理', value: 'projects' },
  { label: '合同管理', value: 'contracts' },
  { label: '付款管理', value: 'payments' },
  { label: '发票管理', value: 'invoices' },
];

const Users: React.FC = () => {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form] = Form.useForm();

  const fetchUsers = async () => {
    setLoading(true);
    try { const data: any = await request.get('/users'); setUsers(data); } catch { message.error('获取失败'); }
    setLoading(false);
  };

  useEffect(() => { if (isAdmin) fetchUsers(); }, [isAdmin]);

  if (!isAdmin) return <Card><p style={{ color: '#FF3B30', textAlign: 'center', padding: 40, fontSize: 16 }}>无权限访问此页面</p></Card>;

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editItem) {
        await request.put(`/users/${editItem.id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/users', values);
        message.success('创建成功');
      }
      setModalOpen(false); form.resetFields(); setEditItem(null); fetchUsers();
    } catch (err: any) { message.error(err.error || '操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try { await request.delete(`/users/${id}`); message.success('删除成功'); fetchUsers(); }
    catch (err: any) { message.error(err.error || '删除失败'); }
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    form.setFieldsValue({ ...item, password: undefined });
    setModalOpen(true);
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', key: 'username', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '真实姓名', dataIndex: 'real_name', key: 'real_name' },
    {
      title: '角色', dataIndex: 'role', key: 'role',
      render: (v: string) => {
        const roleMap: Record<string, { color: string; label: string }> = {
          admin: { color: '#FF3B30', label: '管理员' },
          finance: { color: '#FF9500', label: '财务' },
          user: { color: '#007AFF', label: '普通用户' },
        };
        const r = roleMap[v] || { color: '#007AFF', label: '普通用户' };
        return <Tag color={r.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{r.label}</Tag>;
      }
    },
    {
      title: '权限', dataIndex: 'permissions', key: 'permissions',
      render: (v: string[]) => {
        if (v?.includes('all')) return <Tag color="#AF52DE" style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>全部权限</Tag>;
        return v?.map((p: string) => {
          const o = permissionOptions.find(i => i.value === p);
          return o ? <Tag key={p} style={{ borderRadius: 6, padding: '2px 10px', border: 'none', background: '#f5f5f7', color: '#1d1d1f' }}>{o.label}</Tag> : null;
        });
      }
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => <Tag color={v === 'active' ? '#34C759' : '#86868b'} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{v === 'active' ? '正常' : '禁用'}</Tag>
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作', key: 'action', width: 150,
      render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ color: '#007AFF' }}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>用户管理</span>}
        style={{ borderRadius: 16, border: '1px solid rgba(0,0,0,0.04)' }}
        bordered={false}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditItem(null); form.resetFields(); setModalOpen(true); }}
            style={{ borderRadius: 10, height: 38, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' }}
          >
            新增用户
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          style={{ borderRadius: 12 }}
          scroll={{ x: 1000 }}
        />
      </Card>

      <Modal
        title={editItem ? '编辑用户' : '新增用户'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditItem(null); }}
        width={500}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="请输入用户名" disabled={!!editItem} style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="password" label={editItem ? '密码（留空不修改）' : '密码'} rules={editItem ? [] : [{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="real_name" label="真实姓名">
            <Input placeholder="请输入真实姓名" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="user">
            <Select style={{ borderRadius: 10 }}>
              <Select.Option value="admin">管理员</Select.Option>
              <Select.Option value="finance">财务</Select.Option>
              <Select.Option value="user">普通用户</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select style={{ borderRadius: 10 }}>
              <Select.Option value="active">正常</Select.Option>
              <Select.Option value="disabled">禁用</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="permissions" label="权限配置">
            <Checkbox.Group options={permissionOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Users;
