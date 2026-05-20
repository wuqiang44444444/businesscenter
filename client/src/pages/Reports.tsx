import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Progress, Empty, Spin, Tabs, Select, message } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, AlertOutlined, ClockCircleOutlined } from '@ant-design/icons';
import request from '../utils/request';

interface Summary {
  receivable: { total: number; received: number; outstanding: number; overdue: number; collection_rate: number };
  payable: { total: number; paid: number; outstanding: number; overdue: number; payment_rate: number };
  net_cashflow: number;
  net_expected: number;
}
interface TopCustomer { id: string; name: string; total_contract: number; received: number; outstanding: number; collection_rate: number }
interface TopSupplier { id: string; name: string; total_payable: number; paid: number; outstanding: number; payment_rate: number }
interface MonthlyTrend { month: string; received: number; expected: number; paid: number }
interface OverdueBucket { count: number; amount: number; items: any[] }
interface OverdueReport { receivable: { '0-30': OverdueBucket; '31-60': OverdueBucket; '60+': OverdueBucket }; payable: { '0-30': OverdueBucket; '31-60': OverdueBucket; '60+': OverdueBucket } }
interface ContractStatus { by_status: { status: string; count: number; amount: number }[]; expiring_soon: any[] }
interface TaxMonthly { month: string; amount: number; tax_amount: number; total_amount: number; invoice_count?: number; special_count?: number; bill_count?: number }
interface TaxSummary {
  year: number;
  sales: { monthly: TaxMonthly[]; total_amount: number; total_tax: number; total_with_tax: number; invoice_count: number };
  purchases: { monthly: TaxMonthly[]; total_amount: number; total_tax: number; total_with_tax: number; bill_count: number };
  monthly_net: { month: string; sales_tax: number; purchases_tax: number; net_payable: number }[];
  net_payable: number;
}

const yuan = (n: number) => `¥${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  active: { text: '进行中', color: '#34C759' },
  completed: { text: '已完成', color: '#5AC8FA' },
  cancelled: { text: '已取消', color: '#FF3B30' },
  paused: { text: '已暂停', color: '#FF9500' },
};

// 简易 SVG 折线图（不引第三方库）
const MiniLineChart: React.FC<{ data: MonthlyTrend[] }> = ({ data }) => {
  if (data.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />;
  const w = 760, h = 240, padL = 50, padR = 20, padT = 20, padB = 36;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const maxV = Math.max(1, ...data.flatMap(d => [d.received, d.paid, d.expected]));
  const x = (i: number) => padL + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1));
  const y = (v: number) => padT + innerH - (v / maxV) * innerH;
  const path = (key: keyof MonthlyTrend) => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d[key] as number)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
      {/* 网格线 */}
      {[0, 0.25, 0.5, 0.75, 1].map(p => (
        <line key={p} x1={padL} x2={w - padR} y1={padT + innerH * p} y2={padT + innerH * p} stroke="#f0f0f0" />
      ))}
      {/* Y 轴 label */}
      {[0, 0.5, 1].map(p => (
        <text key={p} x={padL - 8} y={padT + innerH * (1 - p) + 4} fontSize="10" fill="#86868b" textAnchor="end">
          {Math.round((maxV * p) / 1000) + 'k'}
        </text>
      ))}
      {/* X 轴 label */}
      {data.map((d, i) => i % Math.max(1, Math.floor(data.length / 8)) === 0 && (
        <text key={d.month} x={x(i)} y={h - 14} fontSize="10" fill="#86868b" textAnchor="middle">{d.month.slice(2)}</text>
      ))}
      {/* 折线：已收（绿）/ 已付（红）/ 待收（蓝虚线） */}
      <path d={path('expected')} stroke="#5AC8FA" strokeWidth="2" strokeDasharray="4 4" fill="none" />
      <path d={path('received')} stroke="#34C759" strokeWidth="2.5" fill="none" />
      <path d={path('paid')} stroke="#FF3B30" strokeWidth="2.5" fill="none" />
      {/* 数据点 */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.received)} r="3" fill="#34C759" />
          <circle cx={x(i)} cy={y(d.paid)} r="3" fill="#FF3B30" />
        </g>
      ))}
      {/* 图例 */}
      <g transform={`translate(${w - 220}, ${padT})`}>
        <circle cx="6" cy="6" r="4" fill="#34C759" /><text x="16" y="10" fontSize="11" fill="#1d1d1f">已收</text>
        <circle cx="66" cy="6" r="4" fill="#FF3B30" /><text x="76" y="10" fontSize="11" fill="#1d1d1f">已付</text>
        <line x1="120" y1="6" x2="140" y2="6" stroke="#5AC8FA" strokeWidth="2" strokeDasharray="3 3" />
        <text x="146" y="10" fontSize="11" fill="#1d1d1f">待收</text>
      </g>
    </svg>
  );
};

// 饼图（合同状态分布等占比展示）
const MiniPieChart: React.FC<{ data: { label: string; value: number; color: string }[]; size?: number }> = ({ data, size = 200 }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />;
  const r = size / 2 - 4;
  const cx = size / 2, cy = size / 2;
  let acc = 0;
  // 单一分类（占 100%）画整圆，避免 arc 退化成 0 长度
  if (data.length === 1 || data.filter(d => d.value > 0).length === 1) {
    const only = data.find(d => d.value > 0)!;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <svg width={size} height={size}>
          <circle cx={cx} cy={cy} r={r} fill={only.color} />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.map(d => (
            <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: d.color }} />
              <span style={{ color: '#1d1d1f' }}>{d.label}</span>
              <span style={{ color: '#86868b' }}>{d.value > 0 ? '100.0%' : '0.0%'}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  const arcs = data.map((d) => {
    const start = acc / total * Math.PI * 2 - Math.PI / 2;
    acc += d.value;
    const end = acc / total * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const largeArc = d.value / total > 0.5 ? 1 : 0;
    return { d, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z` };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
      <svg width={size} height={size}>
        {arcs.map((a, i) => <path key={i} d={a.path} fill={a.d.color} />)}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: d.color }} />
            <span style={{ color: '#1d1d1f' }}>{d.label}</span>
            <span style={{ color: '#86868b' }}>{((d.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// 堆叠柱图：每月销项税 vs 进项税
const StackedBarChart: React.FC<{ data: { month: string; sales: number; purchases: number }[] }> = ({ data }) => {
  if (data.length === 0 || data.every(d => d.sales === 0 && d.purchases === 0)) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />;
  }
  const w = 760, h = 240, padL = 50, padR = 20, padT = 20, padB = 40;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const maxV = Math.max(1, ...data.map(d => d.sales + d.purchases));
  const barW = (innerW / data.length) * 0.65;
  const slot = innerW / data.length;
  const y = (v: number) => padT + innerH - (v / maxV) * innerH;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
      {[0, 0.25, 0.5, 0.75, 1].map(p => (
        <line key={p} x1={padL} x2={w - padR} y1={padT + innerH * p} y2={padT + innerH * p} stroke="#f0f0f0" />
      ))}
      {[0, 0.5, 1].map(p => (
        <text key={p} x={padL - 8} y={padT + innerH * (1 - p) + 4} fontSize="10" fill="#86868b" textAnchor="end">
          {Math.round((maxV * p) / 1000) + 'k'}
        </text>
      ))}
      {data.map((d, i) => {
        const cx = padL + slot * i + slot / 2;
        const salesH = (d.sales / maxV) * innerH;
        const purH = (d.purchases / maxV) * innerH;
        return (
          <g key={i}>
            <rect x={cx - barW / 2} y={y(d.sales)} width={barW} height={salesH} fill="#5AC8FA" />
            <rect x={cx - barW / 2} y={y(d.sales + d.purchases)} width={barW} height={purH} fill="#FF9500" />
            <text x={cx} y={h - 14} fontSize="10" fill="#86868b" textAnchor="middle">{d.month.slice(-2)}月</text>
          </g>
        );
      })}
      <g transform={`translate(${w - 200}, ${padT})`}>
        <rect x="0" y="0" width="12" height="12" fill="#5AC8FA" /><text x="18" y="10" fontSize="11" fill="#1d1d1f">销项税</text>
        <rect x="80" y="0" width="12" height="12" fill="#FF9500" /><text x="98" y="10" fontSize="11" fill="#1d1d1f">进项税</text>
      </g>
    </svg>
  );
};

const Reports: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [topSuppliers, setTopSuppliers] = useState<TopSupplier[]>([]);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [overdue, setOverdue] = useState<OverdueReport | null>(null);
  const [contractStatus, setContractStatus] = useState<ContractStatus | null>(null);
  const [taxYear, setTaxYear] = useState<number>(new Date().getFullYear());
  const [taxSummary, setTaxSummary] = useState<TaxSummary | null>(null);
  const [taxLoading, setTaxLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [s, tc, ts, mt, od, cs] = await Promise.all([
          request.get('/reports/summary'),
          request.get('/reports/top-customers?limit=10'),
          request.get('/reports/top-suppliers?limit=10'),
          request.get('/reports/monthly-trend?months=12'),
          request.get('/reports/overdue'),
          request.get('/reports/contract-status'),
        ]);
        setSummary(s as any);
        setTopCustomers(tc as any);
        setTopSuppliers(ts as any);
        setTrend(mt as any);
        setOverdue(od as any);
        setContractStatus(cs as any);
      } catch (e: any) {
        message.error(e.error || '加载报表失败');
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setTaxLoading(true);
      try {
        const r: any = await request.get(`/reports/tax-summary?year=${taxYear}`);
        setTaxSummary(r);
      } catch (e: any) {
        message.error(e.error || '加载税务汇总失败');
      } finally { setTaxLoading(false); }
    })();
  }, [taxYear]);

  if (loading || !summary) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;

  const renderOverdueTable = (data: OverdueReport['receivable'] | OverdueReport['payable']) => (
    <Row gutter={[16, 16]}>
      {(['0-30', '31-60', '60+'] as const).map((bucket) => {
        const color = bucket === '0-30' ? '#FF9500' : bucket === '31-60' ? '#FF6B35' : '#FF3B30';
        return (
          <Col xs={24} md={8} key={bucket}>
            <Card styles={{ body: { padding: 16 } }} style={{ borderLeft: `4px solid ${color}` }}>
              <div style={{ color: '#86868b', fontSize: 13, marginBottom: 4 }}>
                <ClockCircleOutlined /> 逾期 {bucket} 天
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color, marginBottom: 4 }}>{yuan(data[bucket].amount)}</div>
              <div style={{ fontSize: 12, color: '#86868b' }}>{data[bucket].count} 笔账款</div>
            </Card>
          </Col>
        );
      })}
    </Row>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: '#1d1d1f' }}>报表统计</h2>
        <p style={{ margin: '4px 0 0', color: '#86868b', fontSize: 13 }}>财务状况一图概览</p>
      </div>

      {/* ===== 1. 应收应付总览 ===== */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<span style={{ fontSize: 15, fontWeight: 600 }}>📥 应收账款</span>}>
            <Row gutter={16}>
              <Col span={12}><Statistic title="总应收" value={summary.receivable.total} precision={2} prefix="¥" /></Col>
              <Col span={12}><Statistic title="已收金额" value={summary.receivable.received} precision={2} prefix="¥" valueStyle={{ color: '#34C759' }} /></Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col span={12}><Statistic title="未收金额" value={summary.receivable.outstanding} precision={2} prefix="¥" valueStyle={{ color: '#FF9500' }} /></Col>
              <Col span={12}><Statistic title="其中逾期" value={summary.receivable.overdue} precision={2} prefix="¥" valueStyle={{ color: '#FF3B30' }} /></Col>
            </Row>
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#86868b', fontSize: 12 }}>回款率</span>
                <strong>{summary.receivable.collection_rate}%</strong>
              </div>
              <Progress percent={summary.receivable.collection_rate} strokeColor={{ '0%': '#34C759', '100%': '#5AC8FA' }} showInfo={false} />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span style={{ fontSize: 15, fontWeight: 600 }}>📤 应付账款</span>}>
            <Row gutter={16}>
              <Col span={12}><Statistic title="总应付" value={summary.payable.total} precision={2} prefix="¥" /></Col>
              <Col span={12}><Statistic title="已付金额" value={summary.payable.paid} precision={2} prefix="¥" valueStyle={{ color: '#FF3B30' }} /></Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col span={12}><Statistic title="未付金额" value={summary.payable.outstanding} precision={2} prefix="¥" valueStyle={{ color: '#FF9500' }} /></Col>
              <Col span={12}><Statistic title="其中逾期" value={summary.payable.overdue} precision={2} prefix="¥" valueStyle={{ color: '#FF3B30' }} /></Col>
            </Row>
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#86868b', fontSize: 12 }}>付款率</span>
                <strong>{summary.payable.payment_rate}%</strong>
              </div>
              <Progress percent={summary.payable.payment_rate} strokeColor={{ '0%': '#FF9500', '100%': '#FF3B30' }} showInfo={false} />
            </div>
          </Card>
        </Col>
      </Row>

      {/* 净现金流 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card>
            <Statistic
              title="净现金流（已收 - 已付）"
              value={summary.net_cashflow}
              precision={2}
              prefix="¥"
              valueStyle={{ color: summary.net_cashflow >= 0 ? '#34C759' : '#FF3B30', fontSize: 28 }}
              suffix={summary.net_cashflow >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <Statistic
              title="预期净现金流（待收 - 待付）"
              value={summary.net_expected}
              precision={2}
              prefix="¥"
              valueStyle={{ color: summary.net_expected >= 0 ? '#5AC8FA' : '#FF9500', fontSize: 28 }}
            />
          </Card>
        </Col>
      </Row>

      {/* ===== 2/3. TOP 客户 / 供应商 ===== */}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title={<span style={{ fontSize: 15, fontWeight: 600 }}>🏆 客户应收 TOP 10</span>}>
            <Table
              size="small"
              dataSource={topCustomers}
              rowKey="id"
              pagination={false}
              columns={[
                { title: '客户', dataIndex: 'name', key: 'name', ellipsis: true },
                { title: '合同总额', dataIndex: 'total_contract', key: 't', align: 'right', render: yuan, width: 120 },
                {
                  title: '回款率', dataIndex: 'collection_rate', key: 'r', width: 130,
                  render: (v: number) => <Progress percent={v} size="small" strokeColor="#34C759" />,
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={<span style={{ fontSize: 15, fontWeight: 600 }}>🏭 供应商应付 TOP 10</span>}>
            <Table
              size="small"
              dataSource={topSuppliers}
              rowKey="id"
              pagination={false}
              columns={[
                { title: '供应商', dataIndex: 'name', key: 'name', ellipsis: true },
                { title: '应付总额', dataIndex: 'total_payable', key: 't', align: 'right', render: yuan, width: 120 },
                {
                  title: '付款率', dataIndex: 'payment_rate', key: 'r', width: 130,
                  render: (v: number) => <Progress percent={v} size="small" strokeColor="#FF9500" />,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* ===== 4. 月度收支趋势 ===== */}
      <Card title={<span style={{ fontSize: 15, fontWeight: 600 }}>📈 近 12 个月收支趋势</span>}>
        <MiniLineChart data={trend} />
      </Card>

      {/* ===== 5. 逾期账款分析 ===== */}
      {overdue && (
        <Card
          title={<span style={{ fontSize: 15, fontWeight: 600 }}><AlertOutlined style={{ color: '#FF3B30' }} /> 逾期账款分析</span>}
        >
          <Tabs
            items={[
              { key: 'r', label: '逾期应收', children: renderOverdueTable(overdue.receivable) },
              { key: 'p', label: '逾期应付', children: renderOverdueTable(overdue.payable) },
            ]}
          />
        </Card>
      )}

      {/* ===== 6. 合同状态分布 + 30 天到期 ===== */}
      {contractStatus && (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={10}>
            <Card title={<span style={{ fontSize: 15, fontWeight: 600 }}>📋 合同状态分布</span>}>
              {contractStatus.by_status.length === 0 ? <Empty description="无合同" /> : (
                <>
                  <MiniPieChart
                    data={contractStatus.by_status.map(s => {
                      const label = STATUS_LABEL[s.status] || { text: s.status, color: '#86868b' };
                      return { label: `${label.text}（${s.count}）`, value: s.count, color: label.color };
                    })}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                  {contractStatus.by_status.map(s => {
                    const label = STATUS_LABEL[s.status] || { text: s.status, color: '#86868b' };
                    return (
                      <div key={s.status}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span><Tag color={label.color} style={{ marginRight: 8 }}>{label.text}</Tag>{s.count} 个</span>
                          <strong>{yuan(s.amount)}</strong>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card title={<span style={{ fontSize: 15, fontWeight: 600 }}>⏰ 30 天内到期合同（{contractStatus.expiring_soon.length}）</span>}>
              <Table
                size="small"
                dataSource={contractStatus.expiring_soon}
                rowKey="id"
                pagination={{ pageSize: 5 }}
                locale={{ emptyText: '近 30 天内无到期合同' }}
                columns={[
                  { title: '合同', dataIndex: 'name', key: 'name', ellipsis: true },
                  { title: '客户', dataIndex: 'customer_name', key: 'c', ellipsis: true },
                  { title: '金额', dataIndex: 'amount', key: 'a', align: 'right', render: yuan, width: 110 },
                  { title: '到期日', dataIndex: 'end_date', key: 'e', width: 100 },
                  {
                    title: '剩余', dataIndex: 'days_left', key: 'd', width: 80,
                    render: (v: number) => <Tag color={v <= 7 ? '#FF3B30' : v <= 15 ? '#FF9500' : '#5AC8FA'}>{v} 天</Tag>,
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* ===== 7. 增值税进项 / 销项 月报 ===== */}
      <Card
        title={<span style={{ fontSize: 15, fontWeight: 600 }}>🧾 增值税进项 / 销项 月报</span>}
        extra={
          <Select
            value={taxYear}
            onChange={setTaxYear}
            style={{ width: 120 }}
            options={Array.from({ length: 6 }, (_, i) => {
              const y = new Date().getFullYear() - i;
              return { value: y, label: `${y} 年` };
            })}
          />
        }
      >
        {taxLoading || !taxSummary ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={24} md={8}>
                <Card styles={{ body: { padding: 16 } }} style={{ borderLeft: `4px solid #5AC8FA` }}>
                  <Statistic
                    title={`${taxYear} 年销项税`}
                    value={taxSummary.sales.total_tax}
                    precision={2}
                    prefix="¥"
                    valueStyle={{ color: '#5AC8FA' }}
                  />
                  <div style={{ fontSize: 12, color: '#86868b', marginTop: 4 }}>
                    {taxSummary.sales.invoice_count} 张发票 · 含税 ¥{taxSummary.sales.total_with_tax.toLocaleString()}
                  </div>
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card styles={{ body: { padding: 16 } }} style={{ borderLeft: `4px solid #FF9500` }}>
                  <Statistic
                    title={`${taxYear} 年进项税`}
                    value={taxSummary.purchases.total_tax}
                    precision={2}
                    prefix="¥"
                    valueStyle={{ color: '#FF9500' }}
                  />
                  <div style={{ fontSize: 12, color: '#86868b', marginTop: 4 }}>
                    {taxSummary.purchases.bill_count} 笔应付 · 含税 ¥{taxSummary.purchases.total_with_tax.toLocaleString()}
                  </div>
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card styles={{ body: { padding: 16 } }} style={{ borderLeft: `4px solid ${taxSummary.net_payable >= 0 ? '#FF3B30' : '#34C759'}` }}>
                  <Statistic
                    title="应纳税额估算（销项 - 进项）"
                    value={Math.abs(taxSummary.net_payable)}
                    precision={2}
                    prefix={taxSummary.net_payable < 0 ? '留抵 ¥' : '¥'}
                    valueStyle={{ color: taxSummary.net_payable >= 0 ? '#FF3B30' : '#34C759' }}
                  />
                  <div style={{ fontSize: 12, color: '#86868b', marginTop: 4 }}>
                    {taxSummary.net_payable < 0 ? '进项大于销项，可结转抵扣' : '仅供参考，以税务系统为准'}
                  </div>
                </Card>
              </Col>
            </Row>
            <div style={{ marginBottom: 16 }}>
              <StackedBarChart
                data={taxSummary.monthly_net.map(m => ({
                  month: m.month,
                  sales: m.sales_tax,
                  purchases: m.purchases_tax,
                }))}
              />
            </div>
            <Table
              size="small"
              dataSource={taxSummary.monthly_net.map((m, i) => ({
                key: m.month,
                month: m.month,
                sales_amount: taxSummary.sales.monthly[i]?.amount || 0,
                sales_tax: m.sales_tax,
                purchases_amount: taxSummary.purchases.monthly[i]?.amount || 0,
                purchases_tax: m.purchases_tax,
                net_payable: m.net_payable,
              }))}
              pagination={false}
              columns={[
                { title: '月份', dataIndex: 'month', key: 'm', width: 90 },
                { title: '销项不含税', dataIndex: 'sales_amount', key: 'sa', align: 'right', render: yuan },
                { title: '销项税', dataIndex: 'sales_tax', key: 'st', align: 'right', render: (v: number) => <span style={{ color: '#5AC8FA' }}>{yuan(v)}</span> },
                { title: '进项不含税', dataIndex: 'purchases_amount', key: 'pa', align: 'right', render: yuan },
                { title: '进项税', dataIndex: 'purchases_tax', key: 'pt', align: 'right', render: (v: number) => <span style={{ color: '#FF9500' }}>{yuan(v)}</span> },
                {
                  title: '本月应纳',
                  dataIndex: 'net_payable',
                  key: 'np',
                  align: 'right',
                  render: (v: number) => (
                    <strong style={{ color: v >= 0 ? '#FF3B30' : '#34C759' }}>
                      {v < 0 ? `留抵 ${yuan(-v)}` : yuan(v)}
                    </strong>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
};

export default Reports;
