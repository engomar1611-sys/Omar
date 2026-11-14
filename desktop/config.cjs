function normalizeServerUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('أدخل عنوان السيرفر');
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error('عنوان السيرفر غير صحيح'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('لا تضع بيانات دخول أو معاملات داخل عنوان السيرفر');
  const local = ['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error('الاتصال يجب أن يكون HTTPS. يسمح بـ HTTP على نفس الجهاز للاختبار المحلي فقط.');
  while (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1);
  const result = parsed.toString();
  return result.endsWith('/') ? result.slice(0, -1) : result;
}
module.exports = { normalizeServerUrl };
