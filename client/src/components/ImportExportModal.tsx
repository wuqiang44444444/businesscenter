import React from 'react';
import { Modal, Button, Alert } from 'antd';

interface ImportExportModalProps {
  visible: boolean;
  onClose: () => void;
  module: string;
  moduleName: string;
  onImportSuccess?: () => void;
}

// 导入/导出功能暂未实现：服务端尚无 /api/import-export/* 接口。
// 当后端补齐后，恢复 git 历史中的旧实现即可。
const ImportExportModal: React.FC<ImportExportModalProps> = ({ visible, onClose, moduleName }) => {
  return (
    <Modal
      title={<span style={{ fontSize: 17, fontWeight: 600 }}>{moduleName} - 导入/导出</span>}
      open={visible}
      onCancel={onClose}
      width={520}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <Alert
        type="info"
        showIcon
        message="此功能正在开发中"
        description="导入/导出依赖的服务端接口尚未实现。功能暂时不可用，请勿使用。"
      />
    </Modal>
  );
};

export default ImportExportModal;
