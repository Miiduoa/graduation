// Input must come directly from the verified school SSO adapter, never users/{uid}.
function dormSsoMembershipFields(userInfo) {
  const value = userInfo.studentId || userInfo.employee_id;
  const studentId = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(studentId)) return {};
  return { studentId };
}
module.exports = { dormSsoMembershipFields };
