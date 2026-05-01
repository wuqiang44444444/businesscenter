import React from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { validate } from '../utils/validate';

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);

  const onFinish = async (values: { username: string; password: string }) => {
    // 复用 shared/schemas 做客户端校验，与服务端同一份规则
    const errs = validate('login', values);
    if (errs) {
      message.error(errs.map(e => e.message).join('；'));
      return;
    }
    setLoading(true);
    try {
      const u = await login(values.username, values.password);
      navigate(u.must_change_password ? '/change-password' : '/', { replace: true });
    } catch (err: any) {
      message.error(err.error || '登录失败');
    }
    setLoading(false);
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #5AC8FA 100%)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* 装饰性背景元素 */}
      <div style={{
        position: 'absolute',
        width: 500,
        height: 500,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.1)',
        top: -200,
        right: -150,
        filter: 'blur(60px)',
      }} />
      <div style={{
        position: 'absolute',
        width: 400,
        height: 400,
        borderRadius: '50%',
        background: 'rgba(90,200,250,0.15)',
        bottom: -150,
        left: -100,
        filter: 'blur(50px)',
      }} />
      <div style={{
        position: 'absolute',
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: 'rgba(118,75,162,0.15)',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        filter: 'blur(40px)',
      }} />

      <Card
        style={{
          width: 440,
          borderRadius: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          zIndex: 1,
        }}
        bordered={false}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #007AFF, #5AC8FA)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 8px 24px rgba(0,122,255,0.3)',
          }}>
            <span style={{ color: '#fff', fontSize: 24, fontWeight: 700 }}>BC</span>
          </div>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: '#1d1d1f' }}>
            Business Center
          </h2>
          <p style={{ color: '#86868b', fontSize: 15, marginTop: 8 }}>欢迎回来，请登录您的账户</p>
        </div>
        <Form onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input
              prefix={<UserOutlined style={{ color: '#86868b' }} />}
              placeholder="用户名"
              style={{ borderRadius: 12, height: 48, fontSize: 15 }}
            />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password
              prefix={<LockOutlined style={{ color: '#86868b' }} />}
              placeholder="密码"
              style={{ borderRadius: 12, height: 48, fontSize: 15 }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{
                height: 48,
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 500,
                background: 'linear-gradient(135deg, #007AFF, #5AC8FA)',
                border: 'none',
                boxShadow: '0 4px 16px rgba(0,122,255,0.3)',
              }}
            >
              登 录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Login;
