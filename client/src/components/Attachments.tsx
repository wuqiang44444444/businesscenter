import React, { useEffect, useState } from 'react';
import { Upload, Button, List, Popconfirm, message, Tooltip, Empty } from 'antd';
import { UploadOutlined, DownloadOutlined, DeleteOutlined, FileOutlined, FileImageOutlined, FilePdfOutlined, FileExcelOutlined, FileWordOutlined, FileZipOutlined } from '@ant-design/icons';
import request from '../utils/request';

// 通用附件管理组件：挂到任意实体详情页
// 用法：<Attachments entity="contracts" entityId={contract.id} />

interface Attachment {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  uploaded_by_name?: string;
}

interface Props {
  entity: 'customers' | 'projects' | 'contracts' | 'invoices' | 'suppliers' | 'accounts_payable' | 'payable_payments' | 'reimbursements';
  entityId: string;
  readOnly?: boolean;
}

const iconFor = (mime: string) => {
  if (!mime) return <FileOutlined />;
  if (mime.startsWith('image/')) return <FileImageOutlined style={{ color: '#5AC8FA' }} />;
  if (mime === 'application/pdf') return <FilePdfOutlined style={{ color: '#FF3B30' }} />;
  if (mime.includes('spreadsheet') || mime.includes('excel')) return <FileExcelOutlined style={{ color: '#34C759' }} />;
  if (mime.includes('word') || mime.includes('document')) return <FileWordOutlined style={{ color: '#007AFF' }} />;
  if (mime.includes('zip')) return <FileZipOutlined style={{ color: '#FF9500' }} />;
  return <FileOutlined />;
};

const sizeText = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const Attachments: React.FC<Props> = ({ entity, entityId, readOnly }) => {
  const [list, setList] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const fetchList = async () => {
    try {
      const data = await request.get(`/attachments/${entity}/${entityId}`);
      setList(data as any);
    } catch (e: any) { /* 静默：可能 entity 还不存在 */ }
  };

  useEffect(() => {
    if (entityId) fetchList();
  }, [entity, entityId]);

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append('files', file);
    setUploading(true);
    try {
      const r = await fetch(`/api/attachments/${entity}/${entityId}`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || '上传失败');
      message.success(`上传成功：${data.inserted.length} 个文件`);
      fetchList();
    } catch (e: any) {
      message.error(e.message || '上传失败');
    } finally {
      setUploading(false);
    }
    return false; // 阻止 antd 默认上传
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/attachments/${id}`);
      message.success('已删除');
      fetchList();
    } catch (e: any) { message.error(e.error || '删除失败'); }
  };

  const handleDownload = async (item: Attachment) => {
    try {
      const r = await fetch(`/api/attachments/file/${item.id}`, { credentials: 'include' });
      if (!r.ok) throw new Error('下载失败');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = item.original_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) { message.error(e.message || '下载失败'); }
  };

  return (
    <div>
      {!readOnly && (
        <Upload
          beforeUpload={handleUpload}
          showUploadList={false}
          multiple={false}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,image/*"
        >
          <Button icon={<UploadOutlined />} loading={uploading} size="small">上传附件</Button>
        </Upload>
      )}

      {list.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无附件" style={{ margin: '20px 0' }} />
      ) : (
        <List
          size="small"
          style={{ marginTop: 12 }}
          dataSource={list}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Tooltip title="下载" key="dl">
                  <Button type="text" icon={<DownloadOutlined />} onClick={() => handleDownload(item)} />
                </Tooltip>,
                ...(readOnly ? [] : [
                  <Popconfirm key="del" title="确定删除此附件？" onConfirm={() => handleDelete(item.id)}>
                    <Button type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                ]),
              ]}
            >
              <List.Item.Meta
                avatar={<span style={{ fontSize: 22 }}>{iconFor(item.mime_type)}</span>}
                title={<a onClick={() => handleDownload(item)}>{item.original_name}</a>}
                description={
                  <span style={{ fontSize: 12, color: '#86868b' }}>
                    {sizeText(item.size)} · {item.uploaded_by_name || '系统'} · {item.created_at?.slice(0, 16)}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
};

export default Attachments;
