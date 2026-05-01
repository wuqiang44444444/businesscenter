import axios from 'axios';

// withCredentials 让浏览器在跨域时也带上 httpOnly cookie。
// 同源（Vite 代理）下也无害。
const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
  withCredentials: true,
});

request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // session 过期 → 清掉本地用户缓存并去登录
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error.response?.data || error);
  }
);

export default request;
