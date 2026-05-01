import React from 'react';
import { Form, Input, Button, Card, message, Alert } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../utils/request';
import { useAuth } from '../contexts/AuthContext';
import { validate } from '../utils/validate';

const ChangePassword: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);
  const forced = !!user?.must_change_password;

  const onFinish = async (values: { old_password: string; new_password: string; confirm: string }) => {
    if (values.new_password !== values.confirm) {
      message.error('两次输入的新密码不一致');
      return;
    }
    const errs = validate('changePassword', { old_password: values.old_password, new_password: values.new_password });
    if (errs) {
      message.error(errs.map(e => e.message).join('；'));
      return;
    }
    setLoading(true);
    try {
      await request.post('/change-password', {
        old_password: values.old_password,
        new_password: values.new_password,
      });
      message.success('密码已修改，请重新登录');
      await logout();
      navigate('/login', { replace: true });
    } catch (err: any) {
      message.error(err.error || '修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f7' }}>
      <Card style={{ width: 440, borderRadius: 16 }} bordered={false}>
        <h2 style={{ marginTop: 0, fontSize: 22, fontWeight: 600 }}>修改密码</h2>
        {forced && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="你正在使用默认密码，请先修改后再使用系统"
          />
        )}
        <Form onFinish={onFinish} layout="vertical" size="large">
          <Form.Item name="old_password" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="原密码" />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '至少 8 位' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="再输一遍" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>
              提交
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default ChangePassword;
