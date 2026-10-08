# Campus One Web image

The image builds the Next.js application from source inside Linux. The runtime is a standalone server on port 8080, runs as the unprivileged `node` user, and checks `/health/live`. The health endpoint only confirms the Web process is alive; it does not certify Firebase, login or school services.

The approved Firebase project is `campus-one-tw`; the intended public domain remains `nuni.tw`. Obtain the six public browser values from that project's registered Web app. Export the following values in the build environment, then build from the repository root:

```sh
docker build -f deploy/web/Dockerfile -t campus-one-web:release \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID \
  --build-arg NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
  --build-arg NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
  --build-arg NEXT_PUBLIC_FIREBASE_APP_ID .
docker run --rm -p 127.0.0.1:8080:8080 campus-one-web:release
```

Browser values are bundled at build time. Changing runtime environment variables does not retarget them. Server credentials, Firebase refresh tokens and service-account files must never be build arguments. The build context excludes `.env` files, private keys, host `node_modules` and host `.next` output. The image loads Sharp during build to verify that its native dependency matches Linux and the target architecture. Build with the intended target platform when preparing an image for Fly.

CI uses explicit test browser values to check packaging; its `campus-one-web:ci` image is not a production configuration or a deployment. Production release requires the selected project's preflight, ready indexes, deployed rules/Functions, real authentication and application checks, and a recorded rollback image before replacing `nuni-web` or changing DNS. No Fly app or domain is created or replaced by this Dockerfile.
