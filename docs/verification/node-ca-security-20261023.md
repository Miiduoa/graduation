# Node and CA security update — 2026-10-23

This is a tested candidate, not a production deployment. Integration base: `20df7c84a77a156382af44fde8ccecd1efde8082`.

## Changes

- Current Web and Functions: Node 22.23.4, using the official Alpine and bookworm-slim immutable image digests.
- Legacy Web: retain Node 24 and its application artifact; replace only the old copied executable with official Node 24.22.1. Both old and new Node 24 use ABI 137. The current Web uses ABI 127.
- Install patched OS CA packages before dependency downloads, shared by build and runtime stages: Alpine `ca-certificates` and `ca-certificates-bundle` at least `20261020-r0`; Debian `ca-certificates` at least `20250419~deb12u2`.
- Pin GitHub jobs, `.nvmrc`, and EAS `base.node` to 22.23.4. The EAS configuration assertion follows the same version. No EAS build was started.
- Use the existing Fly Machines API for the transit release check instead of obtaining an SSH certificate. Machine allowlists, profile checks, failure handling and output filtering remain in place. The check reads the structured remote exit status: flyctl omits a zero `exit_code`; any nonzero or invalid value stops the release even if stdout contains a success report. The CI deployment token's permission for this operation still needs verification in the approved release run.
- Add `deploy/security/verify-tls.cjs`, which sends no application credentials and does not alter TLS or CA configuration. Missing optional modules are recorded; non-certificate transport failures remain inconclusive and cause a nonzero exit.

## Read-only production baseline

At approximately 12:45 UTC, Fly Web release 74 was running on machines `80e447b6140178` and `683e513be2d358`, both using:

`registry.fly.io/nuni-web@sha256:9f3a5b590980fb427241ab13e67520e987254c77e5001c21c91a687019053f92`

The current runtime was 22.23.3 and the legacy runtime was 24.21.0. Both server processes on both machines had no `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `CURL_CA_BUNDLE`, `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`, or `NODE_TLS_REJECT_UNAUTHORIZED` environment overrides. Values of other environment variables were not exported.

Read-only HTTP probes on machine `80e447b6140178`, using both executables, returned HTTP 200 from `dv-g3b-emudhra.we-have-a-problem.com` through global fetch and Node HTTPS. This confirms that these live clients still accept that certificate. The second advisory endpoint failed with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. There is no evidence of intrusion from these checks.

`nuni-functions` is suspended and has no machines. It was not resumed or deployed. Its image can be repaired without starting a paid service.

## Isolated verification

| Check | Result |
| --- | --- |
| Actual Linux amd64 Web Docker build, including legacy application | Passed |
| Actual Linux amd64 Functions Docker build | Passed |
| Current/legacy Web startup and readiness, 512 MB container | Passed; both processes ready |
| Current `/login`, `/life`, `/food`, `/bus`, `/classroom`, `/classroom/login` | HTTP 200 |
| Legacy health, privacy and terms pages | HTTP 200; root retains its redirect |
| Current home JavaScript/CSS assets | 17/17 HTTP success |
| Current native Sharp image operation | Passed, Sharp 0.35.5 |
| Legacy Node shared-library linkage | All libraries resolve |
| Process-management and release guards on patched Node | 32/32 passed |
| Release/transit guards, including Machines API transport | 58/58 passed (includes the 16 release guards above) |
| Functions runtime, HTTP adapter, registry, scheduler, trigger tests | 25/25 passed in patched image |
| Web graceful shutdown | Exit 0, no OOM; observed memory 300.6 MiB of 512 MiB |

The candidate was built with the approved public Firebase browser configuration. No production secrets were copied into the image or local test containers. Authenticated school/provider, database, and account flows were not exercised. The Functions production entrypoint requires a service-account credential; only its isolated runtime tests and credential-free HTTP clients were executed.

### TLS and CA results

Each runtime was tested against a trusted control (`https://nodejs.org/dist/index.json`) and both endpoints from the Render advisory. Any HTTP response from a negative endpoint is a failure. DNS errors, timeouts and connection resets are not certificate rejection evidence.

- Current Web Node 22.23.4 and legacy Node 24.22.1: global fetch and Node HTTPS accept the trusted control and reject **both** advisory endpoints with `CERT_REVOKED`.
- Functions Node 22.23.4: the same result holds for global fetch, Node HTTPS, node-fetch 3.3.2, the installed node-fetch 2.7.0 copies, gaxios 6.7.1 and both installed gaxios 7.1.4 copies. Across all tested Functions clients: **29/33 checks pass**; 18 HTTP/1 negative probes report `CERT_REVOKED`.
- HTTP/2 and gRPC accept the trusted control, but both negative endpoints disconnect before TLS completes. Those checks remain **inconclusive**; the verifier intentionally exits 1 and does not claim a complete pass. Web results are 7/9 per runtime; Functions includes four inconclusive HTTP/2/gRPC probes.
- OS stores were independently tested using curl in disposable containers. The CA bundle SHA-256 was asserted identical before and after installing the test client. Both Alpine and Debian accept the trusted control (HTTP 200, verification result 0) and reject both advisory endpoints (curl exit 60, verification result 20, no HTTP response). No TLS verification was disabled.

Sanitized machine-readable probe reports are in [`node-ca-security-20261023/`](node-ca-security-20261023/). `passed: false` is intentional where HTTP/2/gRPC remains inconclusive. Re-run the verifier with each actual Node executable and additional `--app-root` arguments for nested dependency installations; root-level discovery alone does not cover every transitive version.

### Existing legacy native-module limitation

Loading legacy Sharp 0.35.0 directly fails because `libvips-cpp.so.8.18.3` is absent. The identical failure was reproduced in the unchanged original legacy image with Node 24.21.0. It is not introduced by the Node update. This patch does not replace legacy dependencies or claim that native image processing in that artifact has passed. Current Sharp and the tested legacy server routes work.

## Approval and remaining checks

No merge, image publication, production rollout, credential creation, access expansion, database change, service activation or paid build has been performed. The pull request is a draft.

Before a production change, obtain approval for the exact reviewed revision and target. Preserve the existing Web release workflow's current-main/full-CI gate, two-machine snapshot, immutable rollback image, production-change detection, and update-only rolling deployment. The latest successful release used `transit_profile=live-tdx` and `assignment_file_submit_enabled=true`; retain those settings unless separately authorized.

After approval, verify the app-scoped token's Machines API access, full CI, the legacy native-module limitation, actual deployed executable/package versions on **both** machines, runtime client certificate rejection, public readiness/revision, and authenticated critical flows. Do not start the suspended Functions service without separate authorization. Hosted EAS/Render build OS stores and external API service images are outside the evidence from these local Docker builds.

## Official references

- [Render advisory and validation endpoints](https://render.com/docs/advisory-emudhra)
- [Node 22.23.4](https://nodejs.org/en/blog/release/v22.23.4), [Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1)
- [Official Node Alpine metadata](https://github.com/docker-library/repo-info/blob/master/repos/node/remote/22-alpine.md), [bookworm metadata](https://github.com/docker-library/repo-info/blob/master/repos/node/remote/22-bookworm-slim.md), [Node 24 Alpine metadata](https://github.com/docker-library/repo-info/blob/master/repos/node/remote/24-alpine.md)
- [Alpine CA security update](https://github.com/alpinelinux/aports/commit/e78f5987166c6ffbe23f6472e2e8f040298fe2da), [Debian CA security update](https://security-tracker.debian.org/tracker/DLA-4845-1)
