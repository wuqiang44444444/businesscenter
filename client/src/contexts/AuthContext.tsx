import React, { createContext, useContext, useState, useEffect } from 'react';
import { message } from 'antd';
import request from '../utils/request';

interface User {
  id: string;
  username: string;
  real_name: string;
  role: string;
  permissions: string[];
  must_change_password?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 启动时通过 cookie 验证 session（不再读 localStorage 的 token）
  useEffect(() => {
    (async () => {
      try {
        const me: any = await request.get('/me');
        setUser(me);
      } catch {
        // 401 → request interceptor 已处理
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (username: string, password: string): Promise<User> => {
    const data: any = await request.post('/login', { username, password });
    // 服务端把 token 存到 httpOnly cookie，前端不再保存 token
    setUser(data.user);
    message.success('登录成功');
    return data.user;
  };

  const logout = async () => {
    try { await request.post('/logout'); } catch {}
    setUser(null);
    localStorage.removeItem('user'); // 清掉历史残留
    localStorage.removeItem('token');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
};
