import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Card, Tag, Popconfirm, message, InputNumber, DatePicker, Row, Col, Statistic, Radio } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, SearchOutlined, ImportOutlined, PrinterOutlined } from '@ant-design/icons';
import request from '../utils/request';
import dayjs from 'dayjs';
import ImportExportModal from '../components/ImportExportModal';
import Attachments from '../components/Attachments';

const invoiceStatusMap: Record<string, { color: string; label: string }> = {
  pending: { color: '#FF9500', label: '待审核' },
  approved: { color: '#34C759', label: '已审核' },
  issued: { color: '#007AFF', label: '已开具' },
  rejected: { color: '#FF3B30', label: '已驳回' },
};

// 实时换算预览：根据当前 amount_input + tax_rate + 模式，显示另一边金额和税额
const AmountPreview: React.FC<{ form: any; mode: 'exclusive' | 'inclusive' }> = ({ form, mode }) => {
  const value = Form.useWatch('amount_input', form);
  const rate = Form.useWatch('tax_rate', form);
  if (!value || value <= 0 || rate === undefined) return null;
  const r = Number(rate);
  let amountCents: number, taxCents: number, totalCents: number;
  const valueCents = Math.round(Number(value) * 100);
  if (mode === 'exclusive') {
    amountCents = valueCents;
    taxCents = Math.round(amountCents * r);
    totalCents = amountCents + taxCents;
  } else {
    totalCents = valueCents;
    taxCents = Math.round(totalCents * r / (1 + r));
    amountCents = totalCents - taxCents;
  }
  const yuan = (c: number) => (c / 100).toFixed(2);
  return (
    <div style={{
      marginBottom: 24, padding: '12px 16px',
      background: '#f5f7fa', borderRadius: 10, fontSize: 13, color: '#1d1d1f',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: '#86868b' }}>不含税金额</span>
        <strong>¥{yuan(amountCents)}</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ color: '#86868b' }}>税额</span>
        <strong>¥{yuan(taxCents)}</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingTop: 8, borderTop: '1px solid #e5e7eb' }}>
        <span style={{ color: '#86868b' }}>价税合计</span>
        <strong style={{ color: '#007AFF' }}>¥{yuan(totalCents)}</strong>
      </div>
    </div>
  );
};

const invoiceTypeMap: Record<string, string> = {
  normal: '普票',
  special: '专票',
};

const Invoices: React.FC = () => {
  const [list, setList] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [importExportOpen, setImportExportOpen] = useState(false);
  // 'exclusive' = 不含税金额输入；'inclusive' = 含税金额输入
  const [amountMode, setAmountMode] = useState<'exclusive' | 'inclusive'>('exclusive');
  const [form] = Form.useForm();

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (keyword) params.keyword = keyword;
      if (statusFilter) params.status = statusFilter;
      const data: any = await request.get('/invoices', { params });
      setList(data);
    } catch { message.error('获取失败'); }
    setLoading(false);
  };

  const fetchContracts = async () => {
    try {
      const data: any = await request.get('/contracts');
      setContracts(data);
    } catch {}
  };

  useEffect(() => { fetchList(); fetchContracts(); }, [keyword, statusFilter]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const { amount_input, ...rest } = values;
    // 金额按选择的模式提交：exclusive→amount，inclusive→total_amount，服务端会自动算另一个
    const payload: any = {
      ...rest,
      issue_date: values.issue_date?.format('YYYY-MM-DD'),
      due_date: values.due_date?.format('YYYY-MM-DD'),
    };
    if (!editItem) {
      if (amountMode === 'exclusive') payload.amount = amount_input;
      else payload.total_amount = amount_input;
    }
    try {
      if (editItem) {
        await request.put(`/invoices/${editItem.id}`, payload);
        message.success('更新成功');
      } else {
        await request.post('/invoices', payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      form.resetFields();
      setEditItem(null);
      setAmountMode('exclusive');
      fetchList();
    } catch (err: any) { message.error(err.error || '操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/invoices/${id}`);
      message.success('删除成功');
      fetchList();
    } catch (err: any) { message.error(err.error || '删除失败'); }
  };

  const showDetail = async (item: any) => {
    try {
      const data: any = await request.get(`/invoices/${item.id}`);
      setDetail(data);
      setDetailOpen(true);
    } catch (err: any) { message.error(err.error || '获取详情失败'); }
  };

  const openEdit = (item: any) => {
    setEditItem(item);
    form.setFieldsValue({
      ...item,
      issue_date: item.issue_date ? dayjs(item.issue_date) : undefined,
      due_date: item.due_date ? dayjs(item.due_date) : undefined,
    });
    setModalOpen(true);
  };

  const columns = [
    { title: '发票号', dataIndex: 'invoice_no', key: 'invoice_no', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v || '-'}</strong> },
    {
      title: '合同',
      dataIndex: 'contract_name',
      key: 'contract_name',
      render: (v: string, r: any) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v || '-'}</div>
          <div style={{ fontSize: 12, color: '#86868b' }}>{r.customer_name || ''}</div>
        </div>
      )
    },
    { title: '类型', dataIndex: 'invoice_type', key: 'invoice_type', width: 80, render: (v: string) => <Tag>{invoiceTypeMap[v] || v}</Tag> },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right' as const,
      render: (v: number) => <span style={{ fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span>
    },
    {
      title: '税额',
      dataIndex: 'tax_amount',
      key: 'tax_amount',
      align: 'right' as const,
      render: (v: number) => <span style={{ color: '#86868b' }}>¥{(v || 0).toLocaleString()}</span>
    },
    {
      title: '价税合计',
      dataIndex: 'total_amount',
      key: 'total_amount',
      align: 'right' as const,
      render: (v: number) => <span style={{ fontWeight: 600, color: '#007AFF' }}>¥{(v || 0).toLocaleString()}</span>
    },
    { title: '开票日期', dataIndex: 'issue_date', key: 'issue_date', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => {
        const s = invoiceStatusMap[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => showDetail(record)} style={{ color: '#007AFF' }}>详情</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} style={{ color: '#007AFF' }}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const totalAmount = list.reduce((s: number, c: any) => s + (c.total_amount || 0), 0);
  const pendingCount = list.filter((c: any) => c.status === 'pending').length;

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
              title="发票总数"
              value={list.length}
              valueStyle={{ color: '#007AFF', fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card hoverable style={statCardStyle}>
            <Statistic
              title="价税合计"
              value={totalAmount}
              prefix="¥"
              precision={2}
              valueStyle={{ color: '#34C759', fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card hoverable style={statCardStyle}>
            <Statistic
              title="待审核"
              value={pendingCount}
              valueStyle={{ color: pendingCount > 0 ? '#FF9500' : '#34C759', fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>发票管理</span>}
        style={{ borderRadius: 16, border: '1px solid rgba(0,0,0,0.04)' }}
        bordered={false}
        extra={
          <Space>
            <Input
              placeholder="搜索发票号或合同"
              prefix={<SearchOutlined />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ width: 200, borderRadius: 10 }}
              allowClear
            />
            <Select
              placeholder="状态筛选"
              value={statusFilter}
              onChange={setStatusFilter}
              allowClear
              style={{ width: 120, borderRadius: 10 }}
            >
              <Select.Option value="pending">待审核</Select.Option>
              <Select.Option value="approved">已审核</Select.Option>
              <Select.Option value="issued">已开具</Select.Option>
              <Select.Option value="rejected">已驳回</Select.Option>
            </Select>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => { setEditItem(null); form.resetFields(); setAmountMode('exclusive'); setModalOpen(true); }}
              style={{ borderRadius: 10, height: 38, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' }}
            >
              新增发票
            </Button>
            <Button
              icon={<ImportOutlined />}
              onClick={() => setImportExportOpen(true)}
              style={{ borderRadius: 10 }}
            >
              导入/导出
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={list}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          style={{ borderRadius: 12 }}
        />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        title="发票详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={detail ? (
          <Button icon={<PrinterOutlined />} onClick={() => window.open(`/api/print/invoice/${detail.id}`, '_blank')} type="primary">
            打印发票
          </Button>
        ) : null}
        width={600}
        styles={{ body: { padding: '24px' } }}
      >
        {detail && (
          <div>
            <div style={{ padding: 16, background: 'linear-gradient(135deg, rgba(0,122,255,0.05), rgba(90,200,250,0.05))', borderRadius: 12, marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#86868b', marginBottom: 4 }}>价税合计</div>
              <div style={{ fontSize: 28, fontWeight: 600, color: '#007AFF' }}>¥{(detail.total_amount || 0).toLocaleString()}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div><span style={{ color: '#86868b' }}>发票号：</span>{detail.invoice_no || '-'}</div>
              <div><span style={{ color: '#86868b' }}>类型：</span>{invoiceTypeMap[detail.invoice_type] || detail.invoice_type || '-'}</div>
              <div><span style={{ color: '#86868b' }}>合同：</span>{detail.contract_name || '-'}</div>
              <div><span style={{ color: '#86868b' }}>客户：</span>{detail.customer_name || '-'}</div>
              <div><span style={{ color: '#86868b' }}>不含税金额：</span>¥{(detail.amount || 0).toLocaleString()}</div>
              <div><span style={{ color: '#86868b' }}>税率：</span>{((detail.tax_rate || 0) * 100).toFixed(0)}%</div>
              <div><span style={{ color: '#86868b' }}>税额：</span>¥{(detail.tax_amount || 0).toLocaleString()}</div>
              <div><span style={{ color: '#86868b' }}>状态：</span>
                <Tag color={invoiceStatusMap[detail.status]?.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>
                  {invoiceStatusMap[detail.status]?.label || detail.status}
                </Tag>
              </div>
              <div><span style={{ color: '#86868b' }}>开票日期：</span>{detail.issue_date || '-'}</div>
              <div><span style={{ color: '#86868b' }}>付款截止：</span>{detail.due_date || '-'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#86868b' }}>备注：</span>{detail.remark || '-'}</div>
            </div>

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
              <div style={{ fontWeight: 600, marginBottom: 12, color: '#1d1d1f' }}>发票附件（扫描件 / 影像）</div>
              <Attachments entity="invoices" entityId={detail.id} />
            </div>
          </div>
        )}
      </Modal>

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editItem ? '编辑发票' : '新增发票'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditItem(null); form.resetFields(); }}
        width={550}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="contract_id" label="关联合同" rules={[{ required: true, message: '请选择合同' }]}>
            <Select placeholder="请选择合同" showSearch optionFilterProp="children" style={{ borderRadius: 10 }}>
              {contracts.map((c: any) => (
                <Select.Option key={c.id} value={c.id}>{c.name} - {c.customer_name}</Select.Option>
              ))}
            </Select>
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
          {!editItem && (
            <Form.Item label="金额输入方式">
              <Radio.Group
                value={amountMode}
                onChange={(e) => setAmountMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="exclusive">不含税金额</Radio.Button>
                <Radio.Button value="inclusive">含税金额</Radio.Button>
              </Radio.Group>
            </Form.Item>
          )}
          {!editItem && (
            <Form.Item
              name="amount_input"
              label={amountMode === 'exclusive' ? '不含税金额' : '含税金额（价税合计）'}
              rules={[{ required: true, message: '请输入金额' }]}
            >
              <InputNumber
                style={{ width: '100%', borderRadius: 10 }}
                min={0}
                precision={2}
                placeholder={amountMode === 'exclusive' ? '请输入不含税金额' : '请输入含税金额'}
                addonAfter="元"
              />
            </Form.Item>
          )}
          <Form.Item name="tax_rate" label="税率" initialValue={0.13}>
            <Select style={{ borderRadius: 10 }}>
              <Select.Option value={0.13}>13%</Select.Option>
              <Select.Option value={0.09}>9%</Select.Option>
              <Select.Option value={0.06}>6%</Select.Option>
              <Select.Option value={0}>0%</Select.Option>
            </Select>
          </Form.Item>
          {!editItem && <AmountPreview form={form} mode={amountMode} />}
          <Form.Item name="issue_date" label="开票日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%', borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="due_date" label="付款截止日期">
            <DatePicker style={{ width: '100%', borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="pending">
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
        module="invoices"
        moduleName="发票"
        onImportSuccess={() => fetchList()}
      />
    </div>
  );
};

export default Invoices;
