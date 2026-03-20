const DEFAULT_IOS_BUNDLE_ID = "com.campus.app";

function buildAppleAppSiteAssociation() {
  const teamId = process.env.APPLE_TEAM_ID?.trim() ?? "";
  const bundleId = process.env.IOS_BUNDLE_IDENTIFIER?.trim() || DEFAULT_IOS_BUNDLE_ID;
  const appId = teamId ? `${teamId}.${bundleId}` : null;

  return {
    applinks: {
      apps: [],
      details: appId
        ? [
            {
              appID: appId,
              paths: ["/", "/login/*", "/join/*", "/sso-callback/*"],
            },
          ]
        : [],
    },
  };
}

export async function GET() {
  return new Response(JSON.stringify(buildAppleAppSiteAssociation()), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    },
  });
}
