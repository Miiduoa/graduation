function trimString(value, maxLength = 5000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

const { resolveStoredMerchantMode } = require('./lib/merchantMode');

function normalizeCafeteriaPilotStatus(value) {
  if (value === 'pilot' || value === 'live') {
    return value;
  }
  return 'inactive';
}

function resolveCafeteriaOrderingMetadata(
  cafeteriaData = {},
  { cafeteriaId, fallbackName = null, hasActiveOperator = false, HttpsError },
) {
  const pilotStatus = normalizeCafeteriaPilotStatus(cafeteriaData?.pilotStatus);
  const orderingEnabled = cafeteriaData?.orderingEnabled === true;
  const merchantMode = resolveStoredMerchantMode(cafeteriaData);

  if (
    merchantMode !== 'native_order' ||
    !orderingEnabled ||
    pilotStatus === 'inactive' ||
    !hasActiveOperator
  ) {
    throw new HttpsError('failed-precondition', '店家尚未開通接單');
  }

  return {
    pilotStatus,
    orderingEnabled,
    merchantMode,
    merchantId: trimString(cafeteriaData?.merchantId, 160) || cafeteriaId,
    cafeteriaName:
      trimString(cafeteriaData?.name, 160) || trimString(fallbackName, 160) || cafeteriaId,
  };
}

module.exports = {
  normalizeCafeteriaPilotStatus,
  resolveCafeteriaOrderingMetadata,
  resolveStoredMerchantMode,
};
