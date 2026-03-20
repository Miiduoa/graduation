const DEFAULT_ANDROID_PACKAGE = "com.campus.app";

function buildAssetLinks() {
  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim() || DEFAULT_ANDROID_PACKAGE;
  const shaFingerprints = (process.env.ANDROID_SIGNING_SHA256 ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (shaFingerprints.length === 0) {
    return [];
  }

  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: shaFingerprints,
      },
    },
  ];
}

export async function GET() {
  return Response.json(buildAssetLinks(), {
    headers: {
      "cache-control": "public, max-age=3600",
    },
  });
}
