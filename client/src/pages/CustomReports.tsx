import React, { useEffect, useMemo, useState } from 'react';
import {
  Card, Button, List, Input, Select, Space, Form, Table, message, Popconfirm,
  Tag, Empty, Spin, Divider, InputNumber, DatePicker,
} from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, SaveOutlined, DeleteOutlined,
  DownloadOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import request from '../utils/request';

interface ColumnMeta {
  key: string;
  label: string;
  type: 'string' | 'number' | 'money' | 'date' | 'datetime' | 'enum';
  options?: { value: string; label: string }[];
}
interface SourceMeta {
  key: string;
  label: string;
  columns: ColumnMeta[];
}
interface ReportRow {
  id: string;
  name: string;
  description?: string;
  source: string;
  owner_name?: string;
  created_at: string;
  updated_at: string;
}

const OP_OPTIONS = [
  { value: '=', label: '等于' },
  { value: '!=', label: '不等于' },
  { value: '>', label: '大于' },
  { value: '<', label: '小于' },
  { value: '>=', label: '大于等于' },
  { value: '<=', label: '小于等于' },
  { value: 'like', label: '包含' },
  { value: 'in', label: '在列表中' },
  { value: 'between', label: '区间' },
  { value: 'is_null', label: '为空' },
  { value: 'is_not_null', label: '不为空' },
];

type Filter = { field: string; op: string; value: any };

const CustomReports: React.FC = () => {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState<string>('');
  const [columns, setColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sortField, setSortField] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [limit, setLimit] = useState<number>(1000);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewColumns, setPreviewColumns] = useState<ColumnMeta[]>([]);
  const [previewRows, setPreviewRows] = useState<any[]>([]);

  const currentSource = useMemo(() => sources.find(s => s.key === source), [sources, source]);
  const columnsByKey = useMemo(() => {
    const m: Record<string, ColumnMeta> = {};
    currentSource?.columns.forEach(c => m[c.key] = c);
    return m;
  }, [currentSource]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [list, meta]: any[] = await Promise.all([
        request.get('/custom-reports'),
        request.get('/custom-reports/_meta'),
      ]);
      setReports(list);
      setSources(meta.sources);
    } catch (e: any) {
      message.error(e.error || '加载失败');
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const resetEditor = () => {
    setEditingId(null);
    setName(''); setDescription('');
    setSource(''); setColumns([]); setFilters([]);
    setSortField(undefined); setSortDir('asc'); setLimit(1000);
    setPreviewColumns([]); setPreviewRows([]);
  };

  const loadReport = async (id: string) => {
    try {
      const r: any = await request.get(`/custom-reports/${id}`);
      setEditingId(id);
      setName(r.name); setDescription(r.description || '');
      setSource(r.source);
      const def = r.definition || {};
      setColumns(def.columns || []);
      setFilters(def.filters || []);
      setSortField(def.sort?.field); setSortDir(def.sort?.direction || 'asc');
      setLimit(def.limit || 1000);
      setPreviewColumns([]); setPreviewRows([]);
    } catch (e: any) { message.error(e.error || '加载失败'); }
  };

  // 切数据源时清空列/过滤器/排序，避免引用到不存在的字段
  const onSourceChange = (v: string) => {
    setSource(v); setColumns([]); setFilters([]); setSortField(undefined);
    setPreviewColumns([]); setPreviewRows([]);
  };

  const buildDefinition = () => ({
    source,
    columns,
    filters: filters.filter(f => f.field && f.op),
    sort: sortField ? { field: sortField, direction: sortDir } : null,
    limit,
  });

  const runPreview = async () => {
    if (!source || columns.length === 0) {
      message.warning('请先选择数据源和至少一列');
      return;
    }
    setPreviewLoading(true);
    try {
      const r: any = await request.post('/custom-reports/_preview', { definition: buildDefinition() });
      setPreviewColumns(r.columns);
      setPreviewRows(r.rows);
      if (r.rows.length === 0) message.info('查询返回 0 行');
    } catch (e: any) {
      message.error(e.error || '预览失败');
    } finally { setPreviewLoading(false); }
  };

  const save = async () => {
    if (!name.trim()) return message.warning('请填报表名称');
    if (!source) return message.warning('请选择数据源');
    if (columns.length === 0) return message.warning('请至少选择一列');
    const body = { name: name.trim(), description, source, definition: buildDefinition() };
    try {
      if (editingId) {
        await request.put(`/custom-reports/${editingId}`, body);
        message.success('保存成功');
      } else {
        const r: any = await request.post('/custom-reports', body);
        setEditingId(r.id);
        message.success('已创建');
      }
      fetchAll();
    } catch (e: any) { message.error(e.error || '保存失败'); }
  };

  const del = async (id: string) => {
    try {
      await request.delete(`/custom-reports/${id}`);
      message.success('已删除');
      if (editingId === id) resetEditor();
      fetchAll();
    } catch (e: any) { message.error(e.error || '删除失败'); }
  };

  // 导出 CSV（纯前端，对 previewRows 操作；用 UTF-8 BOM 兼容 Excel 中文）
  const exportCsv = () => {
    if (previewRows.length === 0) return message.info('请先运行预览');
    const head = previewColumns.map(c => c.label);
    const lines = [head.join(',')];
    for (const row of previewRows) {
      lines.push(previewColumns.map(c => {
        const v = row[c.key];
        if (v === null || v === undefined) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || '自定义报表'}_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 渲染过滤器 value 控件 —— 根据 column 类型 + operator 给不同 UI
  const renderValueControl = (f: Filter, idx: number) => {
    const col = columnsByKey[f.field];
    const noValue = f.op === 'is_null' || f.op === 'is_not_null';
    if (noValue) return <span style={{ color: '#86868b', fontSize: 12 }}>—</span>;
    if (!col) return <Input disabled placeholder="请先选字段" style={{ width: 200 }} />;

    const update = (v: any) => {
      const next = [...filters];
      next[idx] = { ...next[idx], value: v };
      setFilters(next);
    };

    // 区间：两个控件
    if (f.op === 'between' || f.op === 'in') {
      // in / between 用 mode='tags' 让用户多输入
      return (
        <Select
          mode={f.op === 'between' ? undefined : 'tags'}
          maxCount={f.op === 'between' ? 2 : undefined}
          value={Array.isArray(f.value) ? f.value : []}
          onChange={update}
          placeholder={f.op === 'between' ? '两个值：开始,结束' : '回车多个值'}
          style={{ width: 260 }}
          tokenSeparators={[',']}
        >
          {f.op === 'between' && col.type === 'enum' && col.options?.map(o => (
            <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
          ))}
        </Select>
      );
    }

    if (col.type === 'enum') {
      return (
        <Select value={f.value} onChange={update} style={{ width: 200 }} placeholder="选择">
          {col.options?.map(o => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
        </Select>
      );
    }
    if (col.type === 'money' || col.type === 'number') {
      return <InputNumber value={f.value} onChange={update} style={{ width: 200 }} placeholder="数值" />;
    }
    if (col.type === 'date' || col.type === 'datetime') {
      return (
        <DatePicker
          value={f.value ? dayjs(f.value) : undefined}
          onChange={(d) => update(d ? d.format('YYYY-MM-DD') : null)}
          style={{ width: 200 }}
        />
      );
    }
    return <Input value={f.value || ''} onChange={(e) => update(e.target.value)} style={{ width: 200 }} placeholder="值" />;
  };

  const tableColumns = previewColumns.map(c => ({
    title: c.label,
    dataIndex: c.key,
    key: c.key,
    render: (v: any) => {
      if (v === null || v === undefined) return <span style={{ color: '#ccc' }}>—</span>;
      if (c.type === 'money') return `¥${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (c.type === 'enum') {
        const opt = c.options?.find(o => o.value === v);
        return opt ? opt.label : String(v);
      }
      return String(v);
    },
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: '#1d1d1f' }}>
            <ExperimentOutlined style={{ marginRight: 8, color: '#5AC8FA' }} />
            自定义报表
          </h2>
          <p style={{ margin: '4px 0 0', color: '#86868b', fontSize: 13 }}>
            选数据源、列、过滤条件，保存后随时跑，结果可导出 CSV
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={resetEditor}
          style={{ borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' }}>
          新建报表
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        {/* 左侧：报表列表 */}
        <Card title="我的报表" styles={{ body: { padding: 0, maxHeight: 600, overflow: 'auto' } }}>
          {loading ? <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div> : (
            <List
              dataSource={reports}
              locale={{ emptyText: '还没有报表' }}
              renderItem={(r) => (
                <List.Item
                  style={{
                    padding: '12px 16px', cursor: 'pointer',
                    background: editingId === r.id ? 'rgba(0,122,255,0.06)' : undefined,
                  }}
                  onClick={() => loadReport(r.id)}
                  actions={[
                    <Popconfirm key="del" title="确定删除？" onConfirm={(e) => { e?.stopPropagation(); del(r.id); }}>
                      <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                    </Popconfirm>,
                  ]}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: '#86868b' }}>
                      <Tag color="#5AC8FA" style={{ border: 'none', fontSize: 11 }}>
                        {sources.find(s => s.key === r.source)?.label || r.source}
                      </Tag>
                      {r.owner_name && <span>· {r.owner_name}</span>}
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </Card>

        {/* 右侧：编辑器 */}
        <Card title={editingId ? '编辑报表' : '新建报表'} styles={{ body: { padding: 20 } }}
          extra={
            <Space>
              <Button icon={<PlayCircleOutlined />} onClick={runPreview} loading={previewLoading}>预览</Button>
              {previewRows.length > 0 && (
                <Button icon={<DownloadOutlined />} onClick={exportCsv}>导出 CSV</Button>
              )}
              <Button type="primary" icon={<SaveOutlined />} onClick={save}
                style={{ borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5AC8FA)', border: 'none' }}>
                {editingId ? '保存' : '新建'}
              </Button>
            </Space>
          }
        >
          <Form layout="vertical">
            <Space style={{ width: '100%' }} size="middle">
              <Form.Item label="报表名称" required style={{ minWidth: 240, marginBottom: 12 }}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：黄金客户欠款明细" />
              </Form.Item>
              <Form.Item label="数据源" required style={{ minWidth: 200, marginBottom: 12 }}>
                <Select value={source} onChange={onSourceChange} placeholder="选择数据源">
                  {sources.map(s => <Select.Option key={s.key} value={s.key}>{s.label}</Select.Option>)}
                </Select>
              </Form.Item>
              <Form.Item label="行数上限" style={{ width: 120, marginBottom: 12 }}>
                <InputNumber value={limit} min={1} max={10000} onChange={(v) => setLimit(v || 1000)} style={{ width: '100%' }} />
              </Form.Item>
            </Space>
            <Form.Item label="说明" style={{ marginBottom: 12 }}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选" />
            </Form.Item>
            <Form.Item label="选择要展示的列" required style={{ marginBottom: 12 }}>
              <Select
                mode="multiple"
                value={columns}
                onChange={setColumns}
                placeholder={source ? '选择列' : '先选数据源'}
                disabled={!source}
                style={{ width: '100%' }}
                optionFilterProp="label"
              >
                {currentSource?.columns.map(c => (
                  <Select.Option key={c.key} value={c.key} label={c.label}>
                    {c.label} <span style={{ color: '#86868b', fontSize: 11 }}>({c.type})</span>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Divider style={{ margin: '12px 0' }}>过滤条件（AND）</Divider>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {filters.map((f, i) => (
                <Space key={i}>
                  <Select
                    value={f.field}
                    onChange={(v) => {
                      const next = [...filters]; next[i] = { ...next[i], field: v, value: undefined }; setFilters(next);
                    }}
                    placeholder="字段"
                    style={{ width: 160 }}
                    disabled={!source}
                  >
                    {currentSource?.columns.map(c => (
                      <Select.Option key={c.key} value={c.key}>{c.label}</Select.Option>
                    ))}
                  </Select>
                  <Select
                    value={f.op}
                    onChange={(v) => {
                      const next = [...filters]; next[i] = { ...next[i], op: v, value: undefined }; setFilters(next);
                    }}
                    style={{ width: 130 }}
                  >
                    {OP_OPTIONS.map(o => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
                  </Select>
                  {renderValueControl(f, i)}
                  <Button type="link" danger size="small" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>删除</Button>
                </Space>
              ))}
              <Button type="dashed" size="small" onClick={() => setFilters([...filters, { field: '', op: '=', value: undefined }])}
                disabled={!source} style={{ width: 200 }}>
                + 添加过滤条件
              </Button>
            </div>

            <Divider style={{ margin: '12px 0' }}>排序</Divider>
            <Space>
              <Select value={sortField} onChange={setSortField} placeholder="不排序" style={{ width: 200 }} allowClear disabled={!source}>
                {currentSource?.columns.map(c => (
                  <Select.Option key={c.key} value={c.key}>{c.label}</Select.Option>
                ))}
              </Select>
              <Select value={sortDir} onChange={setSortDir} style={{ width: 100 }}>
                <Select.Option value="asc">升序</Select.Option>
                <Select.Option value="desc">降序</Select.Option>
              </Select>
            </Space>
          </Form>

          {/* 预览结果 */}
          {previewRows.length > 0 && (
            <>
              <Divider style={{ margin: '16px 0' }}>预览结果（{previewRows.length} 行）</Divider>
              <Table
                size="small"
                columns={tableColumns}
                dataSource={previewRows}
                rowKey={(_, i) => String(i)}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                scroll={{ x: 'max-content' }}
              />
            </>
          )}
          {previewRows.length === 0 && previewColumns.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击「预览」运行查询" />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default CustomReports;
