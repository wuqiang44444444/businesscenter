// validateBody(schema) → middleware：把 req.body 用 schema 解析，失败 400，
// 成功后用解析+默认填充的值替换 req.body，handler 可以放心使用。
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`);
      return res.status(400).json({ error: '请求参数无效', details: issues });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody };
