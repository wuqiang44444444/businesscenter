import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Card, Tag, Popconfirm, message, InputNumber, DatePicker, Descriptions, Divider } from 'antd';
import Attachments from '../components/Attachments';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, DollarOutlined, FileTextOutlined, ImportOutlined } from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import request from '../utils/request';
import dayjs from 'dayjs';
import ImportExportModal from '../components/ImportExportModal';

const paymentModeMap: Record<string, { label: string; color: string }> = {
  monthly: { label: '月付', color: '#007AFF' },
  quarterly: { label: '季付', color: '#5AC8FA' },
  semiannual: { label: '半年付', color: '#34C759' },
  annual: { label: '年付', color: '#AF52DE' },
  once: { label: '一次性支付', color: '#FF9500' },
  installment: { label: '按比例分批', color: '#FF3B30' },
};

const Contracts: React.FC = () => {
  const location = useLocation();
  const [contracts, setContracts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoicesModalOpen, setInvoicesModalOpen] = useState(false);
  const [editInvoiceModalOpen, setEditInvoiceModalOpen] = useState(false);
  const [paymentPlans, setPaymentPlans] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [editingInvoice, setEditingInvoice] = useState<any>(null);
  const [editPayModalOpen, setEditPayModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [paymentForm] = Form.useForm();
  const [invoiceForm] = Form.useForm();
  const [editInvoiceForm] = Form.useForm();
  const [form] = Form.useForm();

  const fetchContracts = async () => {
    setLoading(true);
    try { const data: any = await request.get('/contracts'); setContracts(data); } catch { message.error('获取失败'); }
    setLoading(false);
  };

  const fetchBase = async () => {
    const [c, p]: any[] = await Promise.all([request.get('/customers'), request.get('/projects')]);
    setCustomers(c); setProjects(p);
  };

  useEffect(() => { fetchContracts(); fetchBase(); }, []);

  // 处理从通知跳转过来的URL参数
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openInvoices = params.get('openInvoices');
    const contractId = params.get('contractId');
    const openDetail = params.get('openDetail');

    if (openInvoices === 'true' && contractId) {
      // 延迟执行确保合同数据已加载
      setTimeout(() => {
        openInvoicesModal(contractId);
        // 清除URL参数
        window.history.replaceState({}, '', '/contracts');
      }, 300);
    } else if (openDetail === 'true' && contractId) {
      setTimeout(() => {
        const contract = contracts.find((c: any) => c.id === contractId);
        if (contract) showDetail(contract);
        window.history.replaceState({}, '', '/contracts');
      }, 300);
    }
  }, [location.search, contracts]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values, amount: values.amount || 0,
      start_date: values.start_date?.format('YYYY-MM-DD'),
      end_date: values.end_date?.format('YYYY-MM-DD'),
    };
    try {
      if (editItem) { await request.put(`/contracts/${editItem.id}`, payload); message.success('更新成功'); }
      else { await request.post('/contracts', payload); message.success('创建成功'); }
      setModalOpen(false); form.resetFields(); setEditItem(null); fetchContracts();
    } catch (err: any) { message.error(err.error || '操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try { await request.delete(`/contracts/${id}`); message.success('删除成功'); fetchContracts(); }
    catch (err: any) { message.error(err.error || '删除失败'); }
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    form.setFieldsValue({ ...item, start_date: item.start_date ? dayjs(item.start_date) : undefined, end_date: item.end_date ? dayjs(item.end_date) : undefined });
    setModalOpen(true);
  };

  const showDetail = async (item: any) => {
    try { const data: any = await request.get(`/contracts/${item.id}`); setDetail(data); setDetailOpen(true); }
    catch (err: any) { message.error(err.error || '获取详情失败'); }
  };

  const openPaymentPlans = async (contractId: string) => {
    try { const data: any = await request.get(`/contracts/${contractId}/payment-plans`); setPaymentPlans(data); setPaymentModalOpen(true); }
    catch (err: any) { message.error(err.error || '获取付款计划失败'); }
  };

  const refreshPaymentPlans = async (contractId: string) => {
    const data: any = await request.get(`/contracts/${contractId}/payment-plans`);
    setPaymentPlans(data);
  };

  const openEditPayment = (record: any) => {
    setEditingPayment(record);
    paymentForm.setFieldsValue({
      amount: record.amount,
      remark: record.remark || '',
      due_date: record.due_date ? dayjs(record.due_date) : undefined,
    });
    setEditPayModalOpen(true);
  };

  const handleSavePayment = async () => {
    const values = await paymentForm.validateFields();
    try {
      await request.put(`/payment-plans/${editingPayment.id}`, {
        ...editingPayment,
        amount: values.amount,
        remark: values.remark || '',
        due_date: values.due_date?.format('YYYY-MM-DD') || editingPayment.due_date,
      });
      message.success('保存成功');
      setEditPayModalOpen(false);
      paymentForm.resetFields();
      setEditingPayment(null);
      await refreshPaymentPlans(editingPayment.contract_id);
    } catch (err: any) {
      message.error(err.error || '保存失败');
    }
  };

  // 开票相关
  const openInvoiceModal = (contract: any) => {
    setSelectedContract(contract);
    invoiceForm.resetFields();
    invoiceForm.setFieldsValue({
      contract_id: contract.id,
      invoice_type: 'normal',
      tax_rate: 0.13,
      issue_date: dayjs(),
    });
    setInvoiceModalOpen(true);
  };

  const handleCreateInvoice = async () => {
    const values = await invoiceForm.validateFields();
    try {
      await request.post('/invoices', {
        ...values,
        issue_date: values.issue_date?.format('YYYY-MM-DD'),
        due_date: values.due_date?.format('YYYY-MM-DD'),
      });
      message.success('开票成功，已通知财务人员');
      setInvoiceModalOpen(false);
      invoiceForm.resetFields();
    } catch (err: any) {
      message.error(err.error || '开票失败');
    }
  };

  const openInvoicesModal = async (contractId: string) => {
    try {
      const data: any = await request.get(`/invoices?contract_id=${contractId}`);
      setInvoices(data);
      // 保存当前合同对象，用于编辑后刷新
      const contract = contracts.find((c: any) => c.id === contractId);
      setSelectedContract(contract);
      setInvoicesModalOpen(true);
    } catch (err: any) {
      message.error(err.error || '获取发票列表失败');
    }
  };

  const openEditInvoice = (invoice: any) => {
    setEditingInvoice(invoice);
    editInvoiceForm.setFieldsValue({
      invoice_no: invoice.invoice_no,
      status: invoice.status,
      remark: invoice.remark,
    });
    setEditInvoiceModalOpen(true);
  };

  const handleUpdateInvoice = async () => {
    const values = await editInvoiceForm.validateFields();
    try {
      await request.put(`/invoices/${editingInvoice.id}`, values);
      message.success('更新成功');
      setEditInvoiceModalOpen(false);
      setEditingInvoice(null);
      editInvoiceForm.resetFields();
      // 刷新发票列表
      if (selectedContract) {
        await openInvoicesModal(selectedContract.id);
      }
    } catch (err: any) {
      message.error(err.error || '更新失败');
    }
  };

  const statusMap: Record<string, { color: string; label: string }> = {
    active: { color: '#34C759', label: '生效中' },
    expired: { color: '#86868b', label: '已过期' },
    terminated: { color: '#FF3B30', label: '已终止' },
    draft: { color: '#FF9500', label: '草稿' },
  };

  const invoiceStatusMap: Record<string, { color: string; label: string }> = {
    pending: { color: '#FF9500', label: '待审核' },
    approved: { color: '#34C759', label: '已审核' },
    issued: { color: '#007AFF', label: '已开具' },
    rejected: { color: '#FF3B30', label: '已驳回' },
  };

  const payStatusMap: Record<string, { color: string; label: string }> = {
    pending: { color: '#FF9500', label: '待支付' },
    paid: { color: '#34C759', label: '已支付' },
    overdue: { color: '#FF3B30', label: '逾期' },
  };

  const columns = [
    { title: '合同编号', dataIndex: 'contract_no', key: 'contract_no', width: 130, render: (v: string) => v || '-' },
    { title: '合同名称', dataIndex: 'name', key: 'name', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '客户', dataIndex: 'customer_name', key: 'customer_name' },
    { title: '关联项目', dataIndex: 'project_name', key: 'project_name', render: (v: string) => v || '-' },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (v: number) => <span style={{ color: '#007AFF', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span>
    },
    {
      title: '付费模式',
      dataIndex: 'payment_mode',
      key: 'payment_mode',
      width: 110,
      render: (v: string) => {
        const m = paymentModeMap[v];
        return m ? <Tag color={m.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{m.label}</Tag> : v;
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) => {
        const s = statusMap[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
    { title: '开始日期', dataIndex: 'start_date', key: 'start_date', width: 110 },
    { title: '结束日期', dataIndex: 'end_date', key: 'end_date', width: 110 },
    {
      title: '操作',
      key: 'action',
      width: 260,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => showDetail(record)} style={{ color: '#007AFF' }}>详情</Button>
          <Button type="link" size="small" icon={<DollarOutlined />} onClick={() => openPaymentPlans(record.id)} style={{ color: '#34C759' }}>付款</Button>
          <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => openInvoiceModal(record)} style={{ color: '#5AC8FA' }}>开票</Button>
          <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => openInvoicesModal(record.id)}>发票</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ color: '#007AFF' }}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const payColumns = [
    { title: '期次', dataIndex: 'period', key: 'period', width: 120 },
    { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: number) => `¥${(v || 0).toLocaleString()}` },
    { title: '应付日期', dataIndex: 'due_date', key: 'due_date', width: 110 },
    { title: '实付日期', dataIndex: 'actual_date', key: 'actual_date', width: 110, render: (v: string) => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) => {
        const s = payStatusMap[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditPayment(record)}>编辑</Button>
          {record.status !== 'paid' && (
            <Button size="small" type="primary" onClick={async () => {
              await request.put(`/payment-plans/${record.id}`, { ...record, status: 'paid', actual_date: dayjs().format('YYYY-MM-DD') });
              message.success('已标记为已支付');
              await refreshPaymentPlans(record.contract_id);
            }}>确认付款</Button>
          )}
          <Popconfirm title="确定删除？" onConfirm={async () => {
            await request.delete(`/payment-plans/${record.id}`);
            await refreshPaymentPlans(record.contract_id);
          }}><Button size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button></Popconfirm>
        </Space>
      )
    }
  ];

  const invoiceColumns = [
    { title: '发票号', dataIndex: 'invoice_no', key: 'invoice_no', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '类型', dataIndex: 'invoice_type', key: 'invoice_type', width: 80, render: (v: string) => <Tag>{v === 'normal' ? '普票' : '专票'}</Tag> },
    { title: '金额', dataIndex: 'amount', key: 'amount', render: (v: number) => `¥${(v || 0).toLocaleString()}` },
    { title: '税率', dataIndex: 'tax_rate', key: 'tax_rate', render: (v: number) => `${(v * 100).toFixed(0)}%` },
    { title: '税额', dataIndex: 'tax_amount', key: 'tax_amount', render: (v: number) => `¥${(v || 0).toLocaleString()}` },
    { title: '价税合计', dataIndex: 'total_amount', key: 'total_amount', render: (v: number) => <span style={{ fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span> },
    { title: '开票日期', dataIndex: 'issue_date', key: 'issue_date' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => {
        const s = invoiceStatusMap[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: any) => (
        <Button size="small" type="link" onClick={() => openEditInvoice(record)} style={{ color: '#007AFF' }}>
          编辑
        </Button>
      )
    },
  ];

  return (
    <div>
      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>合同管理</span>}
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
              onClick={() => { setEditItem(null); form.resetFields(); setModalOpen(true); }}
              style={{ borderRadius: 10, height: 38, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' }}
            >
              新增合同
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={contracts}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1400 }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          style={{ borderRadius: 12 }}
        />
      </Card>

      {/* 合同详情弹窗 */}
      <Modal
        title="合同详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={700}
        styles={{ body: { padding: '24px' } }}
      >
        {detail && (
          <div>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="合同名称">{detail.name}</Descriptions.Item>
              <Descriptions.Item label="合同编号">{detail.contract_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="客户">{detail.customer_name}</Descriptions.Item>
              <Descriptions.Item label="关联项目">{detail.project_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="金额">¥{(detail.amount || 0).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="付款模式">
                <Tag color={paymentModeMap[detail.payment_mode]?.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>
                  {paymentModeMap[detail.payment_mode]?.label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="开始日期">{detail.start_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="结束日期">{detail.end_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>{detail.description || '-'}</Descriptions.Item>
            </Descriptions>

            <Divider titlePlacement="left" style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>合同附件</Divider>
            <Attachments entity="contracts" entityId={detail.id} />
          </div>
        )}
      </Modal>

      {/* 合同编辑弹窗 */}
      <Modal
        title={editItem ? '编辑合同' : '新增合同'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditItem(null); }}
        width={660}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="合同名称" rules={[{ required: true, message: '请输入' }]}>
            <Input placeholder="请输入合同名称" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="contract_no" label="合同编号"><Input placeholder="如: HT-2026-001" style={{ width: 200, borderRadius: 10 }} /></Form.Item>
            <Form.Item name="amount" label="合同金额" rules={[{ required: true, message: '请输入' }]}>
              <InputNumber style={{ width: 200, borderRadius: 10 }} min={0} placeholder="金额" addonAfter="元" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="customer_id" label="客户" rules={[{ required: true, message: '请选择' }]}>
              <Select placeholder="请选择客户" showSearch optionFilterProp="children" style={{ width: 200, borderRadius: 10 }}>
                {customers.map((c: any) => <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>)}
              </Select>
            </Form.Item>
            <Form.Item name="project_id" label="关联项目">
              <Select placeholder="请选择项目" allowClear style={{ width: 200, borderRadius: 10 }}>
                {projects.map((p: any) => <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>)}
              </Select>
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="payment_mode" label="付费模式" initialValue="monthly">
              <Select style={{ width: 200, borderRadius: 10 }}>{Object.entries(paymentModeMap).map(([k, v]) => <Select.Option key={k} value={k}>{v.label}</Select.Option>)}</Select>
            </Form.Item>
            <Form.Item name="status" label="状态" initialValue="active">
              <Select style={{ width: 200, borderRadius: 10 }}>
                <Select.Option value="active">生效中</Select.Option><Select.Option value="draft">草稿</Select.Option>
                <Select.Option value="expired">已过期</Select.Option><Select.Option value="terminated">已终止</Select.Option>
              </Select>
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="start_date" label="开始日期"><DatePicker style={{ width: 200, borderRadius: 10 }} /></Form.Item>
            <Form.Item name="end_date" label="结束日期"><DatePicker style={{ width: 200, borderRadius: 10 }} /></Form.Item>
          </Space>
          <Form.Item name="description" label="描述"><Input.TextArea rows={3} placeholder="请输入描述" style={{ borderRadius: 10 }} /></Form.Item>
        </Form>
      </Modal>

      {/* 付款计划管理弹窗 */}
      <Modal
        title="付款计划管理"
        open={paymentModalOpen}
        onCancel={() => setPaymentModalOpen(false)}
        footer={null}
        width={900}
        styles={{ body: { padding: '24px' } }}
      >
        <Table columns={payColumns} dataSource={paymentPlans} rowKey="id" pagination={false} size="small" />
      </Modal>

      {/* 编辑付款计划弹窗 */}
      <Modal
        title="编辑付款计划"
        open={editPayModalOpen}
        onOk={handleSavePayment}
        onCancel={() => { setEditPayModalOpen(false); setEditingPayment(null); paymentForm.resetFields(); }}
        width={480}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={paymentForm} layout="vertical">
          <Form.Item label="期次">
            <Input value={editingPayment?.period} disabled style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber style={{ width: '100%', borderRadius: 10 }} min={0} precision={2} placeholder="请输入实际金额" addonAfter="元" />
          </Form.Item>
          <Form.Item name="due_date" label="应付日期">
            <DatePicker style={{ width: '100%', borderRadius: 10 }} placeholder="选择应付日期" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注信息，如金额调整原因等" style={{ borderRadius: 10 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 开票弹窗 */}
      <Modal
        title="开具发票"
        open={invoiceModalOpen}
        onOk={handleCreateInvoice}
        onCancel={() => setInvoiceModalOpen(false)}
        width={550}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={invoiceForm} layout="vertical">
          <Form.Item name="contract_id" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="合同名称">
            <Input value={selectedContract?.name} disabled style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item label="合同金额">
            <Input value={selectedContract?.amount ? `¥${selectedContract.amount.toLocaleString()}` : ''} disabled style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="invoice_no" label="发票号码" rules={[{ required: true, message: '请输入发票号码' }]}>
            <Input placeholder="如: 12345678" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="invoice_type" label="发票类型" initialValue="normal">
            <Select style={{ borderRadius: 10 }}>
              <Select.Option value="normal">普票</Select.Option>
              <Select.Option value="special">专票</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="amount" label="不含税金额" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber style={{ width: '100%', borderRadius: 10 }} min={0} precision={2} placeholder="请输入不含税金额" addonAfter="元" />
          </Form.Item>
          <Form.Item name="tax_rate" label="税率" initialValue={0.13}>
            <Select style={{ borderRadius: 10 }}>
              <Select.Option value={0.13}>13%</Select.Option>
              <Select.Option value={0.09}>9%</Select.Option>
              <Select.Option value={0.06}>6%</Select.Option>
              <Select.Option value={0}>0%</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="issue_date" label="开票日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%', borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="due_date" label="付款截止日期">
            <DatePicker style={{ width: '100%', borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="备注信息" style={{ borderRadius: 10 }} />
          </Form.Item>
          <div style={{ padding: 12, background: 'linear-gradient(135deg, rgba(0,122,255,0.05), rgba(90,200,250,0.05))', borderRadius: 8 }}>
            <div style={{ color: '#86868b', fontSize: 12, marginBottom: 4 }}>预计价税合计</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#007AFF' }}>¥{((invoiceForm.getFieldValue('amount') || 0) * (1 + (invoiceForm.getFieldValue('tax_rate') || 0.13))).toLocaleString()}</div>
          </div>
        </Form>
      </Modal>

      {/* 发票列表弹窗 */}
      <Modal
        title="合同发票"
        open={invoicesModalOpen}
        onCancel={() => setInvoicesModalOpen(false)}
        footer={null}
        width={1000}
        styles={{ body: { padding: '24px' } }}
      >
        <Table columns={invoiceColumns} dataSource={invoices} rowKey="id" pagination={false} size="small" />
      </Modal>

      {/* 编辑发票弹窗 */}
      <Modal
        title="编辑发票"
        open={editInvoiceModalOpen}
        onOk={handleUpdateInvoice}
        onCancel={() => { setEditInvoiceModalOpen(false); setEditingInvoice(null); editInvoiceForm.resetFields(); }}
        width={500}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={editInvoiceForm} layout="vertical">
          <Form.Item name="invoice_no" label="发票号码" rules={[{ required: true, message: '请输入发票号码' }]}>
            <Input placeholder="请输入发票号码" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select style={{ borderRadius: 10 }}>
              <Select.Option value="pending">待审核</Select.Option>
              <Select.Option value="approved">已审核</Select.Option>
              <Select.Option value="issued">已开具</Select.Option>
              <Select.Option value="rejected">已驳回</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="备注信息" style={{ borderRadius: 10 }} />
          </Form.Item>
        </Form>
      </Modal>

      <ImportExportModal
        visible={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        module="contracts"
        moduleName="合同"
        onImportSuccess={() => fetchContracts()}
      />
    </div>
  );
};

export default Contracts;
