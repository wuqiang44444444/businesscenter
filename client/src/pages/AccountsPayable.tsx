import React, { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, Card, Tag, Popconfirm, message, InputNumber, DatePicker, Descriptions, Divider, Statistic, Row, Col, Progress } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, DollarOutlined, EyeOutlined, ImportOutlined, PrinterOutlined } from '@ant-design/icons';
import request from '../utils/request';
import dayjs from 'dayjs';
import Attachments from '../components/Attachments';
import ImportExportModal from '../components/ImportExportModal';

const apStatusMap: Record<string, { color: string; label: string }> = {
  pending: { color: '#FF9500', label: '待付款' },
  partial: { color: '#007AFF', label: '部分付款' },
  paid: { color: '#34C759', label: '已付清' },
  overdue: { color: '#FF3B30', label: '逾期' },
};

const AccountsPayable: React.FC = () => {
  const [list, setList] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payingItem, setPayingItem] = useState<any>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [overdueModalOpen, setOverdueModalOpen] = useState(false);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [payForm] = Form.useForm();
  const [form] = Form.useForm();

  const fetchList = async () => {
    setLoading(true);
    try { const data: any = await request.get('/accounts-payable'); setList(data); } catch { message.error('获取失败'); }
    setLoading(false);
  };

  const fetchBase = async () => {
    const [s, p, b]: any[] = await Promise.all([
      request.get('/suppliers'),
      request.get('/projects'),
      request.get('/bank-accounts'),
    ]);
    setSuppliers(s); setProjects(p); setBankAccounts(b);
  };

  useEffect(() => { fetchList(); fetchBase(); }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      amount: values.amount || 0,
      due_date: values.due_date?.format('YYYY-MM-DD'),
    };
    try {
      if (editItem) {
        await request.put(`/accounts-payable/${editItem.id}`, payload);
        message.success('更新成功');
      } else {
        await request.post('/accounts-payable', payload);
        message.success('创建成功');
      }
      setModalOpen(false); form.resetFields(); setEditItem(null); fetchList();
    } catch (err: any) { message.error(err.error || '操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try { await request.delete(`/accounts-payable/${id}`); message.success('删除成功'); fetchList(); }
    catch (err: any) { message.error(err.error || '删除失败'); }
  };

  const showDetail = async (item: any) => {
    try { const data: any = await request.get(`/accounts-payable/${item.id}`); setDetail(data); setDetailOpen(true); }
    catch (err: any) { message.error(err.error || '获取详情失败'); }
  };

  const openPay = (item: any) => {
    setPayingItem(item);
    payForm.resetFields();
    // 自动填默认账户
    const defaultBank = bankAccounts.find(b => b.is_default && b.status === 'active');
    payForm.setFieldsValue({
      amount: item.amount - (item.paid_amount || 0),
      payment_date: dayjs(),
      bank_account_id: defaultBank?.id,
    });
    setPayModalOpen(true);
  };

  const handlePay = async () => {
    const values = await payForm.validateFields();
    try {
      await request.post('/payable-payments', {
        payable_id: payingItem.id,
        amount: values.amount,
        payment_date: values.payment_date?.format('YYYY-MM-DD'),
        payment_method: values.payment_method,
        bank_account_id: values.bank_account_id || null,
        remark: values.remark,
      });
      message.success('付款登记成功');
      setPayModalOpen(false); payForm.resetFields(); setPayingItem(null); fetchList();
    } catch (err: any) { message.error(err.error || '操作失败'); }
  };

  const handleDeletePayment = async (payId: string, payableId: string) => {
    try {
      await request.delete(`/payable-payments/${payId}`);
      message.success('删除成功');
      const data: any = await request.get(`/accounts-payable/${payableId}`);
      setDetail(data);
      fetchList();
    } catch (err: any) { message.error(err.error || '删除失败'); }
  };

  const totalAmount = list.reduce((s: number, c: any) => s + (c.amount || 0), 0);
  const totalPaid = list.reduce((s: number, c: any) => s + (c.paid_amount || 0), 0);
  const totalPending = totalAmount - totalPaid;
  const overdueList = list.filter((c: any) => c.status === 'overdue' || (c.status === 'pending' && c.due_date && new Date(c.due_date) < new Date()));
  const overdueCount = overdueList.length;

  const columns = [
    { title: '摘要', dataIndex: 'title', key: 'title', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier_name' },
    { title: '关联项目', dataIndex: 'project_name', key: 'project_name', render: (v: string) => v || '-' },
    { title: '发票号', dataIndex: 'invoice_no', key: 'invoice_no', width: 130, render: (v: string) => v || '-' },
    {
      title: '应付金额',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right' as const,
      render: (v: number) => <span style={{ fontWeight: 600, color: '#1d1d1f' }}>¥{(v || 0).toLocaleString()}</span>
    },
    {
      title: '已付金额',
      dataIndex: 'paid_amount',
      key: 'paid_amount',
      align: 'right' as const,
      render: (v: number, record: any) => {
        const pct = record.amount > 0 ? Math.round((v / record.amount) * 100) : 0;
        return (
          <span style={{ color: pct >= 100 ? '#34C759' : '#007AFF', fontWeight: 600 }}>
            ¥{(v || 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: '#86868b' }}>({pct}%)</span>
          </span>
        );
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => {
        const s = apStatusMap[v] || { color: '#86868b', label: v };
        return <Tag color={s.color} style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{s.label}</Tag>;
      }
    },
    { title: '到期日', dataIndex: 'due_date', key: 'due_date', width: 110 },
    {
      title: '操作',
      key: 'action',
      width: 250,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => showDetail(record)} style={{ color: '#007AFF' }}>详情</Button>
          {record.status !== 'paid' && (
            <Button type="link" size="small" icon={<DollarOutlined />} onClick={() => openPay(record)} style={{ color: '#34C759' }}>付款</Button>
          )}
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => {
            setEditItem(record);
            form.setFieldsValue({ ...record, due_date: record.due_date ? dayjs(record.due_date) : undefined });
            setModalOpen(true);
          }} style={{ color: '#007AFF' }}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const paymentColumns = [
    { title: '付款日期', dataIndex: 'payment_date', key: 'payment_date', width: 110 },
    {
      title: '付款金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (v: number) => <span style={{ color: '#34C759', fontWeight: 600 }}>¥{(v || 0).toLocaleString()}</span>
    },
    {
      title: '付款方式',
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 100,
      render: (v: string) => {
        const map: Record<string, string> = { bank_transfer: '银行转账', cash: '现金', check: '支票', other: '其他' };
        return map[v] || v || '-';
      }
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, record: any) => (
        <Popconfirm title="确定删除此付款记录？" onConfirm={() => handleDeletePayment(record.id, record.payable_id)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ color: '#FF3B30' }}>删除</Button>
        </Popconfirm>
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
        <Col xs={24} sm={6}>
          <Card hoverable style={statCardStyle}>
            <Statistic
              title="应付总额"
              value={totalAmount}
              prefix="¥"
              valueStyle={{ color: '#007AFF', fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card hoverable style={statCardStyle}>
            <Statistic
              title="已付金额"
              value={totalPaid}
              prefix="¥"
              valueStyle={{ color: '#34C759', fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card hoverable style={statCardStyle}>
            <Statistic
              title="待付金额"
              value={totalPending}
              prefix="¥"
              valueStyle={{ color: '#FF9500', fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card
            hoverable
            style={{ ...statCardStyle, cursor: overdueCount > 0 ? 'pointer' : 'default' }}
            onClick={() => overdueCount > 0 && setOverdueModalOpen(true)}
          >
            <Statistic
              title={<span>逾期笔数 {overdueCount > 0 && <span style={{ fontSize: 12, color: '#007AFF', fontWeight: 400 }}>点击查看</span>}</span>}
              value={overdueCount}
              valueStyle={{ color: overdueCount > 0 ? '#FF3B30' : '#34C759', fontSize: 26, fontWeight: 600 }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={<span style={{ fontSize: 18, fontWeight: 600, color: '#1d1d1f' }}>应付账款</span>}
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
              新增应付账款
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={list}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          style={{ borderRadius: 12 }}
        />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        title="应付账款详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={detail ? (
          <Button icon={<PrinterOutlined />} onClick={() => window.open(`/api/print/payment-notice/${detail.id}`, '_blank')} type="primary">
            打印付款通知单
          </Button>
        ) : null}
        width={720}
        styles={{ body: { padding: '24px' } }}
      >
        {detail && (
          <div>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="摘要">{detail.title}</Descriptions.Item>
              <Descriptions.Item label="发票号">{detail.invoice_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="供应商">{detail.supplier_name}</Descriptions.Item>
              <Descriptions.Item label="关联项目">{detail.project_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="应付金额">¥{(detail.amount || 0).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="已付金额">¥{(detail.paid_amount || 0).toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="到期日">{detail.due_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">{apStatusMap[detail.status]?.label || detail.status}</Descriptions.Item>
              <Descriptions.Item label="描述" span={2}>{detail.description || '-'}</Descriptions.Item>
            </Descriptions>
            {detail.amount > 0 && (
              <div style={{ marginTop: 20, textAlign: 'center', padding: 16, background: 'linear-gradient(135deg, rgba(0,122,255,0.05), rgba(90,200,250,0.05))', borderRadius: 12 }}>
                <Progress
                  type="circle"
                  percent={Math.round((detail.paid_amount / detail.amount) * 100)}
                  format={() => `${Math.round((detail.paid_amount / detail.amount) * 100)}%`}
                  strokeColor={{ '0%': '#007AFF', '100%': '#5AC8FA' }}
                  size={120}
                />
                <div style={{ marginTop: 12, color: '#86868b', fontSize: 14 }}>付款进度</div>
              </div>
            )}
            {detail.payments?.length > 0 && (
              <>
                <Divider>付款记录</Divider>
                <Table columns={paymentColumns} dataSource={detail.payments} rowKey="id" pagination={false} size="small" />
              </>
            )}

            <Divider titlePlacement="left" style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f' }}>附件（合同复印件 / 付款凭证）</Divider>
            <Attachments entity="accounts_payable" entityId={detail.id} />
          </div>
        )}
      </Modal>

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editItem ? '编辑应付账款' : '新增应付账款'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setEditItem(null); }}
        width={600}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="摘要" rules={[{ required: true, message: '请输入摘要' }]}>
            <Input placeholder="请输入应付账款摘要" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="supplier_id" label="供应商" rules={[{ required: true, message: '请选择' }]}>
              <Select placeholder="请选择供应商" showSearch optionFilterProp="children" style={{ width: 220, borderRadius: 10 }}>
                {suppliers.filter((s: any) => s.status === 'active').map((s: any) => <Select.Option key={s.id} value={s.id}>{s.name}</Select.Option>)}
              </Select>
            </Form.Item>
            <Form.Item name="project_id" label="关联项目">
              <Select placeholder="请选择项目" allowClear style={{ width: 220, borderRadius: 10 }}>
                {projects.map((p: any) => <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>)}
              </Select>
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="amount" label="应付金额" rules={[{ required: true, message: '请输入金额' }]}>
              <InputNumber style={{ width: 220, borderRadius: 10 }} min={0} precision={2} placeholder="金额" addonAfter="元" />
            </Form.Item>
            <Form.Item name="due_date" label="到期日">
              <DatePicker style={{ width: 220, borderRadius: 10 }} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="invoice_no" label="发票号"><Input placeholder="发票号" style={{ width: 220, borderRadius: 10 }} /></Form.Item>
            <Form.Item name="status" label="状态" initialValue="pending">
              <Select style={{ width: 220, borderRadius: 10 }}>
                <Select.Option value="pending">待付款</Select.Option>
                <Select.Option value="partial">部分付款</Select.Option>
                <Select.Option value="paid">已付清</Select.Option>
                <Select.Option value="overdue">逾期</Select.Option>
              </Select>
            </Form.Item>
          </Space>
          <Form.Item name="description" label="描述"><Input.TextArea rows={3} placeholder="请输入描述" style={{ borderRadius: 10 }} /></Form.Item>
        </Form>
      </Modal>

      {/* 付款弹窗 */}
      <Modal
        title="登记付款"
        open={payModalOpen}
        onOk={handlePay}
        onCancel={() => { setPayModalOpen(false); setPayingItem(null); }}
        width={480}
        styles={{ body: { padding: '24px' } }}
        okButtonProps={{ style: { borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        {payingItem && (
          <div style={{ marginBottom: 16, padding: 14, background: 'linear-gradient(135deg, rgba(0,122,255,0.08), rgba(90,200,250,0.08))', borderRadius: 12 }}>
            <div><strong>{payingItem.title}</strong></div>
            <div style={{ color: '#86868b', marginTop: 6, fontSize: 13 }}>
              应付: <span style={{ color: '#1d1d1f', fontWeight: 500 }}>¥{(payingItem.amount || 0).toLocaleString()}</span> | 已付: <span style={{ color: '#34C759', fontWeight: 500 }}>¥{(payingItem.paid_amount || 0).toLocaleString()}</span> | 待付: <span style={{ color: '#FF3B30', fontWeight: 600 }}>¥{((payingItem.amount || 0) - (payingItem.paid_amount || 0)).toLocaleString()}</span>
            </div>
          </div>
        )}
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label="本次付款金额" rules={[{ required: true, message: '请输入付款金额' }]}>
            <InputNumber style={{ width: '100%', borderRadius: 10 }} min={0.01} precision={2} placeholder="请输入付款金额" addonAfter="元" />
          </Form.Item>
          <Form.Item name="payment_date" label="付款日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%', borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="payment_method" label="付款方式">
            <Select placeholder="请选择付款方式" style={{ borderRadius: 10 }}>
              <Select.Option value="bank_transfer">银行转账</Select.Option>
              <Select.Option value="cash">现金</Select.Option>
              <Select.Option value="check">支票</Select.Option>
              <Select.Option value="other">其他</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="bank_account_id" label="付款账户" tooltip="选了之后该账户余额会扣除该金额">
            <Select placeholder="不选则不记入任何账户" allowClear style={{ borderRadius: 10 }}>
              {bankAccounts.filter(ba => ba.status === 'active').map(ba => (
                <Select.Option key={ba.id} value={ba.id}>
                  {ba.name} {ba.is_default ? '（默认）' : ''} {ba.account_number ? `· ${ba.account_number.slice(-4)}` : ''}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息" style={{ borderRadius: 10 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 逾期列表弹窗 */}
      <Modal
        title={<span style={{ color: '#FF3B30', fontSize: 17, fontWeight: 600 }}>逾期应付账款明细</span>}
        open={overdueModalOpen}
        onCancel={() => setOverdueModalOpen(false)}
        footer={null}
        width={800}
        styles={{ body: { padding: '24px' } }}
      >
        <Table
          dataSource={overdueList}
          rowKey="id"
          pagination={false}
          size="small"
          columns={[
            { title: '摘要', dataIndex: 'title', key: 'title', render: (v: string) => <strong style={{ color: '#1d1d1f' }}>{v}</strong> },
            { title: '供应商', dataIndex: 'supplier_name', key: 'supplier_name' },
            { title: '关联项目', dataIndex: 'project_name', key: 'project_name', render: (v: string) => v || '-' },
            {
              title: '应付金额', dataIndex: 'amount', key: 'amount', align: 'right' as const,
              render: (v: number) => <span style={{ fontWeight: 600, color: '#1d1d1f' }}>¥{(v || 0).toLocaleString()}</span>
            },
            {
              title: '待付金额', key: 'pending_amount', align: 'right' as const,
              render: (_: any, r: any) => <span style={{ color: '#FF3B30', fontWeight: 600 }}>¥{((r.amount || 0) - (r.paid_amount || 0)).toLocaleString()}</span>
            },
            {
              title: '到期日', dataIndex: 'due_date', key: 'due_date', width: 110,
              render: (v: string) => <span style={{ color: '#FF3B30' }}>{v}</span>
            },
            {
              title: '逾期天数', key: 'overdue_days', width: 90, align: 'center' as const,
              render: (_: any, r: any) => {
                if (!r.due_date) return '-';
                const days = Math.ceil((Date.now() - new Date(r.due_date).getTime()) / (1000 * 60 * 60 * 24));
                return <Tag color="#FF3B30" style={{ borderRadius: 6, padding: '2px 10px', border: 'none' }}>{days} 天</Tag>;
              }
            },
            {
              title: '操作', key: 'action', width: 140,
              render: (_: any, record: any) => (
                <Space size="small">
                  <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setOverdueModalOpen(false); showDetail(record); }} style={{ color: '#007AFF' }}>详情</Button>
                  <Button type="link" size="small" icon={<DollarOutlined />} onClick={() => { setOverdueModalOpen(false); openPay(record); }} style={{ color: '#34C759' }}>付款</Button>
                </Space>
              )
            }
          ]}
          summary={(data) => {
            const totalOverdue = data.reduce((s: number, r: any) => s + (r.amount || 0) - (r.paid_amount || 0), 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}><strong>合计</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={3} />
                <Table.Summary.Cell index={4} align="right"><strong style={{ color: '#FF3B30' }}>¥{totalOverdue.toLocaleString()}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={5} colSpan={3} />
              </Table.Summary.Row>
            );
          }}
        />
      </Modal>

      <ImportExportModal
        visible={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        module="accountsPayable"
        moduleName="应付账款"
        onImportSuccess={() => fetchList()}
      />
    </div>
  );
};

export default AccountsPayable;
