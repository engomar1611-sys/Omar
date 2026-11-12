function normalizeServerUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('أدخل عنوان السيرفر');
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error('عنوان السيرفر غير صحيح'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('لا تضع بيانات دخول أو معاملات داخل عنوان السيرفر');
  const local = ['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error('الاتصال يجب أن يكون HTTPS. يسمح بـ HTTP على نفس الجهاز للاختبار المحلي فقط.');
  parsed.pathname = parsed.pathname.replace(/\\/+$/, '') || '/';
  return parsed.toString().replace(/\\/$/, '');
}
module.exports = { normalizeServerUrl };
