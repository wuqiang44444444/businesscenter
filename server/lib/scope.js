// 数据权限：根据当前用户角色判断能看到哪些记录
// admin / finance → 全部
// 其它（user 等） → 仅 owner_id = self.id

function canSeeAll(user) {
  return user?.role === 'admin' || user?.role === 'finance';
}

// 给 SELECT SQL 加上 owner 过滤条件
// 用法：const { clause, params } = scopeWhere(req.user, 'ct')
// 返回 ' AND ct.owner_id = ?' + [user.id]，或 '' + []
function scopeWhere(user, alias) {
  if (canSeeAll(user)) return { clause: '', params: [] };
  const prefix = alias ? `${alias}.` : '';
  return { clause: ` AND ${prefix}owner_id = ?`, params: [user.id] };
}

// 检查具体一行用户是否有权访问/操作
// 返回 true 通过；false 禁止（404 / 403 由调用方决定）
function canAccess(user, row) {
  if (canSeeAll(user)) return true;
  if (!row) return false;
  return row.owner_id === user.id;
}

module.exports = { canSeeAll, scopeWhere, canAccess };
