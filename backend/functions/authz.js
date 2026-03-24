const { HttpsError } = require("firebase-functions/v2/https");

const SERVICE_ROLE_DOMAINS = [
  "orders",
  "repairs",
  "packages",
  "printing",
  "health",
];

const CAFETERIA_OPERATOR_ROLES = ["owner", "manager", "staff"];

function normalizeServiceRoleRecord(value = {}) {
  const normalized = {
    status: value?.status === "inactive" ? "inactive" : "active",
  };

  for (const domain of SERVICE_ROLE_DOMAINS) {
    normalized[domain] = value?.[domain] === true;
  }

  return normalized;
}

function hasServiceDomainAccess(value = {}, domain = null) {
  const normalized = normalizeServiceRoleRecord(value);
  if (normalized.status !== "active") return false;

  if (domain) {
    return normalized[domain] === true;
  }

  return SERVICE_ROLE_DOMAINS.some((key) => normalized[key] === true);
}

function normalizeCafeteriaOperatorRecord(value = {}) {
  return {
    status: value?.status === "inactive" ? "inactive" : "active",
    role: CAFETERIA_OPERATOR_ROLES.includes(value?.role) ? value.role : "staff",
    displayName:
      typeof value?.displayName === "string" && value.displayName.trim()
        ? value.displayName.trim()
        : null,
    email:
      typeof value?.email === "string" && value.email.trim()
        ? value.email.trim()
        : null,
    lastActiveAt: value?.lastActiveAt ?? null,
  };
}

function hasActiveCafeteriaOperator(value = {}) {
  return normalizeCafeteriaOperatorRecord(value).status === "active";
}

function toSchoolMemberRole(role) {
  if (role === "admin") return "admin";
  if (role === "teacher" || role === "staff") return "editor";
  return "member";
}

function resolveDirectoryRoleLabel(membershipRole, appRole = null) {
  if (membershipRole === "admin" || appRole === "admin") return "管理員";
  if (membershipRole === "editor") return "編輯者";
  if (appRole === "teacher" || appRole === "staff") return "教學成員";
  return "學生";
}

function buildSchoolDirectoryProfile({ uid, userData = {}, membership = {} }) {
  const rawDisplayName =
    typeof userData.displayName === "string" && userData.displayName.trim()
      ? userData.displayName.trim()
      : typeof userData.name === "string" && userData.name.trim()
        ? userData.name.trim()
        : uid.slice(0, 8);

  const avatarUrl =
    typeof userData.avatarUrl === "string" && userData.avatarUrl.trim()
      ? userData.avatarUrl.trim()
      : typeof userData.photoURL === "string" && userData.photoURL.trim()
        ? userData.photoURL.trim()
        : null;

  return {
    displayName: rawDisplayName,
    avatarUrl,
    department:
      typeof userData.department === "string" && userData.department.trim()
        ? userData.department.trim()
        : null,
    roleLabel: resolveDirectoryRoleLabel(membership?.role ?? null, userData?.role ?? null),
    isDiscoverable: userData?.isPublicProfile !== false && userData?.isDiscoverable !== false,
  };
}

function createAuthzHelpers(db) {
  async function getActiveSchoolMembership(schoolId, uid) {
    if (!schoolId || !uid) return null;

    const membershipDoc = await db
      .collection("schools")
      .doc(schoolId)
      .collection("members")
      .doc(uid)
      .get();

    if (!membershipDoc.exists) return null;

    const membership = membershipDoc.data() || {};
    if (membership.status && membership.status !== "active") {
      return null;
    }

    return membership;
  }

  async function assertActiveSchoolMember(schoolId, uid) {
    const membership = await getActiveSchoolMembership(schoolId, uid);
    if (!membership) {
      throw new HttpsError("permission-denied", "User is not an active member of this school");
    }
    return membership;
  }

  async function getServiceRoleRecord(schoolId, uid) {
    if (!schoolId || !uid) return normalizeServiceRoleRecord();

    const docSnap = await db
      .collection("schools")
      .doc(schoolId)
      .collection("serviceRoles")
      .doc(uid)
      .get();

    return normalizeServiceRoleRecord(docSnap.exists ? docSnap.data() : {});
  }

  async function assertSchoolAdminOrEditor(schoolId, uid) {
    const membership = await assertActiveSchoolMember(schoolId, uid);
    if (!["admin", "editor"].includes(membership.role)) {
      throw new HttpsError("permission-denied", "Admin or editor access required");
    }
    return membership;
  }

  async function assertServiceRole(schoolId, uid, domain) {
    const membership = await assertActiveSchoolMember(schoolId, uid);
    if (["admin", "editor"].includes(membership.role)) {
      return {
        membership,
        override: true,
        serviceRole: normalizeServiceRoleRecord(),
      };
    }

    const serviceRole = await getServiceRoleRecord(schoolId, uid);
    if (!hasServiceDomainAccess(serviceRole, domain)) {
      throw new HttpsError("permission-denied", `Missing ${domain} operator permission`);
    }

    return {
      membership,
      override: false,
      serviceRole,
    };
  }

  async function getCafeteriaOperatorRecord(schoolId, cafeteriaId, uid) {
    if (!schoolId || !cafeteriaId || !uid) return null;

    const operatorDoc = await db
      .collection("schools")
      .doc(schoolId)
      .collection("cafeterias")
      .doc(cafeteriaId)
      .collection("operators")
      .doc(uid)
      .get();

    if (!operatorDoc.exists) return null;

    const operator = normalizeCafeteriaOperatorRecord(operatorDoc.data() || {});
    return operator.status === "active" ? operator : null;
  }

  async function assertCafeteriaOperator(schoolId, cafeteriaId, uid) {
    const operator = await getCafeteriaOperatorRecord(schoolId, cafeteriaId, uid);
    if (!operator) {
      throw new HttpsError("permission-denied", "Cafeteria operator access required");
    }
    return operator;
  }

  return {
    assertActiveSchoolMember,
    assertCafeteriaOperator,
    assertSchoolAdminOrEditor,
    assertServiceRole,
    getCafeteriaOperatorRecord,
    getActiveSchoolMembership,
    getServiceRoleRecord,
  };
}

module.exports = {
  CAFETERIA_OPERATOR_ROLES,
  SERVICE_ROLE_DOMAINS,
  buildSchoolDirectoryProfile,
  createAuthzHelpers,
  hasActiveCafeteriaOperator,
  hasServiceDomainAccess,
  normalizeCafeteriaOperatorRecord,
  normalizeServiceRoleRecord,
  resolveDirectoryRoleLabel,
  toSchoolMemberRole,
};
