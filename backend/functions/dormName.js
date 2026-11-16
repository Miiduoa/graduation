// Dorm projections must never expose login's student-ID placeholder as a real name.
function dormName(value, ...studentIds) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (
    !name ||
    /^[a-zA-Z0-9_-]+\s*同學$/.test(name) ||
    studentIds.some(
      (id) => typeof id === 'string' && id && name.toLowerCase().includes(id.toLowerCase()),
    )
  )
    return '姓名待確認';
  return name;
}
module.exports = { dormName };
