import React, { useState, useEffect } from 'react';
import { Modal, Button, Upload, Table, message, Space, Tag, Alert } from 'antd';
import { UploadOutlined, DownloadOutlined, FileExcelOutlined, ClearOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import request from '../utils/request';

interface ImportExportModalProps {
  visible: boolean;
  onClose: () => void;
  module: string;       // customers / projects / contracts / invoices / suppliers / accounts-payable
  moduleName: string;
  onImportSuccess?: () => void;
}

interface PreviewData {
  previewId: string;
  success: any[];
  errors: { row: number; errors: string[]; raw: Record<string, any> }[];
  total: number;
}

// 用 fetch 下载 blob（axios 也可以，但 fetch 更直接）。cookie 跟随。
async function downloadBlob(url: string, filename: string) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    let errMsg = '下载失败';
    try {
      const j = await r.json();
      errMsg = j.error || errMsg;
    } catch {}
    throw new Error(errMsg);
  }
  const blob = await r.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

const ImportExportModal: React.FC<ImportExportModalProps> = ({ visible, onClose, module, moduleName, onImportSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!visible) {
      setFileList([]);
      setPreview(null);
    }
  }, [visible]);

  const handleTemplate = async () => {
    setLoading(true);
    try {
      await downloadBlob(`/api/import-export/template/${module}`, `${moduleName}_导入模板.xlsx`);
      message.success('模板已下载');
    } catch (e: any) { message.error(e.message || '下载失败'); }
    finally { setLoading(false); }
  };

  const handleExport = async () => {
    setLoading(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadBlob(`/api/import-export/export/${module}`, `${moduleName}_导出_${date}.xlsx`);
      message.success('导出成功');
    } catch (e: any) { message.error(e.message || '导出失败'); }
    finally { setLoading(false); }
  };

  const handlePreview = async () => {
    if (fileList.length === 0) { message.warning('请先选择文件'); return; }
    const fd = new FormData();
    fd.append('file', fileList[0].originFileObj as File);
    setUploading(true);
    try {
      const r = await fetch(`/api/import-export/import/${module}/preview`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '解析失败');
      setPreview(data);
      message.success(`解析完成：${data.success.length} 条可导入，${data.errors.length} 条错误`);
    } catch (e: any) {
      message.error(e.message || '解析失败');
      setPreview(null);
    } finally { setUploading(false); }
  };

  const handleConfirm = async () => {
    if (!preview || !preview.previewId) return;
    setConfirming(true);
    try {
      const r: any = await request.post(`/import-export/import/${module}/confirm`, { previewId: preview.previewId });
      message.success(`成功导入 ${r.inserted} 条`);
      onImportSuccess?.();
      handleReset();
      onClose();
    } catch (e: any) {
      message.error(e.error || '导入失败');
    } finally { setConfirming(false); }
  };

  const handleReset = () => {
    setFileList([]);
    setPreview(null);
  };

  // 预览表格：把成功行的字段名转成中文表头不太可能（动态），直接显示行号 + JSON
  const successColumns = preview && preview.success.length > 0
    ? [
        { title: 'Excel 行号', dataIndex: 'row', key: 'row', width: 90 },
        ...Object.keys(preview.success[0])
          .filter(k => k !== 'row' && !k.endsWith('_id') || k === 'contract_id')
          .slice(0, 5)
          .map(k => ({ title: k, dataIndex: k, key: k, ellipsis: true })),
      ]
    : [];

  const errorColumns = [
    { title: 'Excel 行号', dataIndex: 'row', key: 'row', width: 90 },
    {
      title: '错误', key: 'errors',
      render: (_: any, r: any) => Array.isArray(r.errors) ? r.errors.join('；') : (r.error || '未知'),
    },
  ];

  return (
    <Modal
      title={<span style={{ fontSize: 17, fontWeight: 600 }}>{moduleName} - 导入/导出</span>}
      open={visible}
      onCancel={onClose}
      width={900}
      footer={null}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Alert
          type="info"
          showIcon
          message="使用说明"
          description={
            <>
              1. 先「下载模板」拿到对应的 Excel 格式<br />
              2. 按模板填好数据<br />
              3. 上传 → 预览 → 确认导入<br />
              4. 关联字段（如客户/项目/合同名）需要填名称，系统会自动查找对应记录
            </>
          }
        />

        <Space>
          <Button icon={<DownloadOutlined />} onClick={handleTemplate} loading={loading}>下载模板</Button>
          <Button icon={<FileExcelOutlined />} onClick={handleExport} loading={loading}>导出全部数据</Button>
        </Space>

        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>导入数据</div>
          <Space>
            <Upload
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList }) => { setFileList(fileList); setPreview(null); }}
              accept=".xlsx,.xls"
              maxCount={1}
              disabled={!!preview}
            >
              <Button icon={<UploadOutlined />} disabled={!!preview}>选择 Excel 文件</Button>
            </Upload>
            <Button type="primary" onClick={handlePreview} loading={uploading}
              disabled={fileList.length === 0 || !!preview}>
              预览
            </Button>
            {(fileList.length > 0 || preview) && (
              <Button icon={<ClearOutlined />} onClick={handleReset}>重置</Button>
            )}
          </Space>
        </div>

        {preview && (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <Tag color="blue">总行数：{preview.total}</Tag>
              <Tag color="green">可导入：{preview.success.length}</Tag>
              <Tag color="red">错误：{preview.errors.length}</Tag>
              {preview.success.length > 0 && (
                <Button type="primary" loading={confirming} onClick={handleConfirm}
                  style={{ marginLeft: 'auto' }}>
                  确认导入 {preview.success.length} 条
                </Button>
              )}
            </div>

            {preview.errors.length > 0 && (
              <>
                <div style={{ fontWeight: 500, color: '#FF3B30' }}>错误数据</div>
                <Table
                  columns={errorColumns}
                  dataSource={preview.errors}
                  rowKey={(_, i) => `e-${i ?? 0}`}
                  pagination={{ pageSize: 5 }}
                  size="small"
                />
              </>
            )}

            {preview.success.length > 0 && (
              <>
                <div style={{ fontWeight: 500, color: '#34C759' }}>可导入数据预览（前 5 字段）</div>
                <Table
                  columns={successColumns}
                  dataSource={preview.success}
                  rowKey={(r, i) => `s-${r.row ?? i ?? 0}`}
                  pagination={{ pageSize: 5 }}
                  size="small"
                />
              </>
            )}
          </>
        )}
      </Space>
    </Modal>
  );
};

export default ImportExportModal;
