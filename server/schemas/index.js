// 前后端共用的 schema 定义在 ../../shared/schemas/index.mjs（ESM）。
// 因为 server 是 CJS，无法直接 require ESM，由 server/index.js 在启动时
// 调用 initSchemas() 把构建好的 schemas 对象塞进这里的 cache。
//
// 路由文件可以照常 `const schemas = require('../schemas');`，cache 引用稳定。

const cache = {};

async function initSchemas() {
  const { z } = require('zod');
  const mod = await import('../../shared/schemas/index.mjs');
  const built = mod.default(z);
  Object.assign(cache, built);
}

cache.initSchemas = initSchemas;

module.exports = cache;
