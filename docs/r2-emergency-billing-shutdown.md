# R2 emergency billing shutdown

Use this runbook for an unexpected billing email, rapidly increasing R2 usage, or a suspected runaway scraper/request loop. Stop new billable application operations first, then assess and reduce excess storage. This is a manual credential-revocation procedure; it adds no Worker, gateway, or application kill switch.

## Emergency checklist: revoke the eight R2 tokens

1. Open the correct Cloudflare account → **Manage Account → Account API tokens**.
2. For **each** token below, choose **three-dot menu → Delete → confirm**. Check off each name only after its entry disappears:

   - [ ] `kartiseret-run-artifacts-prod-app`
   - [ ] `kartiseret-run-artifacts-prod-dataflow`
   - [ ] `kartiseret-run-artifacts-dev-app`
   - [ ] `kartiseret-run-artifacts-dev-dataflow`
   - [ ] `kartiseret-artwork-prod-app`
   - [ ] `kartiseret-artwork-prod-dataflow`
   - [ ] `kartiseret-artwork-dev-app`
   - [ ] `kartiseret-artwork-dev-dataflow`

3. Leave the D1-only tokens **`kartiseret-run-logs-prod`** and **`kartiseret-run-logs-dev`** alone.
4. Check for [other access paths](#check-for-other-access-paths), then [confirm shutdown](#confirm-the-shutdown).
5. Optionally stop the offending scraper, scheduler, or job to prevent retry loops and unrelated resource consumption.
6. [Assess stored data](#assess-and-clean-up-excess-storage); storage charges can continue after revocation.

**Delete tokens, not buckets or stored objects.** Token deletion revokes the associated credentials without deleting stored data. Creating replacement credentials alone does not invalidate the old ones. Cloudflare documents account token destruction in its [Delete Token API](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/delete/) and token lifetime in [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/).

Expect application disruption: artwork reads, artifact uploads, and cleanup using these credentials will fail once revocation is enforced. Cached artwork may still be served without reaching R2.

## What revocation stops and its limits

Once revocation is enforced, applications using the deleted tokens cannot successfully read, write, list, or delete R2 objects, including jobs already running. Requests already in progress may finish. Do not assume instantaneous enforcement or a fixed propagation time; confirm the result operationally.

This stops the known application access paths; it is not an unconditional account-wide “R2 off” switch. Dashboard access, authorized administrators, other credentials/integrations, public bucket access, and Worker bindings are separate paths. See [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/), [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), and [Worker bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/).

Authentication/authorization failures are not billed as R2 operations; other failed requests can be billable. See [failed-request billing](https://developers.cloudflare.com/r2/pricing/#will-i-be-charged-for-failed-requests-to-my-r2-bucket).

## Check for other access paths

Repeat these checks during an incident, especially if configuration has changed:

1. In **R2 → each bucket → Settings**, inspect all four known buckets and any added since the historical check:

   - `kartiseret-artwork-dev`
   - `kartiseret-artwork-prod`
   - `kartiseret-run-artifacts-dev`
   - `kartiseret-run-artifacts-prod`

   **Public Development URL / r2.dev** must be disabled, and **Custom Domains** must have no enabled public access. Check both independently: disabling one does not disable the other. See [public bucket access](https://developers.cloudflare.com/r2/buckets/public-buckets/).

2. Open **My Profile → API Tokens** and inspect additional R2-capable user tokens, including their permission policies. Account and user tokens are separate; see [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/).
3. Open **Workers & Pages → each Worker → Bindings** and look for R2 bindings. These do not depend on the eight application tokens. Check any Pages Functions bindings as applicable. See [R2 Worker bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/).
4. Inspect any additional account credentials, temporary credentials, integrations, or automation that could access R2. If a bypass exists, contain that path separately and verify it no longer succeeds. The eight-token checklist alone is insufficient in that case.

### Historical account observations — November 17, 2026

The prior connected-account check reported exactly the four buckets listed above, all with `r2.dev` disabled and no connected custom domains. The account's Worker scripts list was empty. Jeremy confirmed there were no R2-capable User API tokens.

The billing dashboard showed **Workers Free — active** and **R2 Paid — enabled**. R2 Paid permits charges beyond included allowances; its enabled state alone does not show that charges have accrued. D1 follows the Workers plan: under Workers Free, reads/writes stop at daily limits and storage limits block further storage growth rather than charging overages. See [D1 pricing and Free-plan limit behavior](https://developers.cloudflare.com/d1/platform/pricing/).

These are historical observations supplied for this runbook, not permanent guarantees or a new live account audit. Recheck bucket settings, user/account tokens, Workers bindings, and the current subscriptions in **Manage Account → Billing**. Repeat the alert checks below. Official provider documentation was checked on November 17, 2026; account settings were not independently reverified while writing this document.

## Confirm the shutdown

- Refresh **Account API tokens** and confirm all eight entries are gone; confirm the two D1-only entries remain.
- Inspect application/job errors for authentication or access-denied failures from the old credentials. Check each affected runtime/environment for any continuing successful R2 activity.
- Use R2 activity and application logs together to assess whether successful operations have stopped. Delayed usage charts do not establish immediate enforcement, and a cached HTTP success does not establish that R2 credentials still work.
- Record the revocation time and observations. Investigate continued successful operations for a missed token or bypass path. Do not run a load test or intentionally generate large request volumes to prove shutdown.

## Assess and clean up excess storage

Revocation leaves stored files in place and does not stop storage billing. Use the Cloudflare dashboard, whose authorized access remains available, to inspect each bucket's storage and carefully remove data that is no longer needed. Do not blindly delete referenced production artwork or required run artifacts. Consult [artwork operations](catalog-artwork-r2.md), [run artifacts](cloudflare-run-artifacts.md), and [shared cleanup safeguards](shared-cleanup.md) before selecting data to remove; automated cleanup using revoked tokens will fail.

Inspect pending multipart uploads as another possible source of stored bytes. Review and abort only uploads confirmed abandoned; see [multipart upload lifecycle guidance](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

Aim to keep total account-wide Standard storage comfortably below the included allowance. Data deletion does not refund accrued charges; billing and metrics can update later. No deletion or account change is performed by adding this runbook.

## Billing in plain language

As verified on November 17, 2026, [R2 Standard pricing](https://developers.cloudflare.com/r2/pricing/) is:

| Meter | Included each month, account-wide | Overage rate |
| --- | --- | --- |
| Storage | 10 GB-month | $0.015 per GB-month |
| Class A operations (e.g. writes/lists) | 1 million | $4.50 per million |
| Class B operations (e.g. reads) | 10 million | $0.36 per million |

Allowances are shared across buckets. Storage uses the average of daily peaks over the billing period. Usage rounds up to billing units: whole GB-months and million-operation units.

Exactly 11 GB of total Standard storage held for a full month gives 1 GB-month above the included 10: **$0.015 in storage usage charges**, before applicable invoice rounding/taxes and separate operation charges. This is not the entire invoice. Retaining the data can cause recurring storage charges in later months.

Standard has no minimum retention duration. Infrequent Access has different rates, retrieval fees, a 30-day minimum, and no Standard free allowance. Object deletion is free; listing during cleanup consumes Class A operations. Recheck [current pricing](https://developers.cloudflare.com/r2/pricing/) before estimating costs.

## Billing alerts

In the correct account, open **Manage Account → Billing → Billable usage → Budget alerts**. Inspect each alert's threshold, enabled state, and recipient addresses. These account-wide alerts measure combined usage-based spend, rather than R2 alone. See [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/).

The prior November 17, 2026 check reported:

| Alert | Threshold | State | Recipient |
| --- | --- | --- | --- |
| Default budget alert (auto-created) | $10 | Enabled | jeremyjacob101@gmail.com |
| Billing Budget Alert 1 cent | $0.01 | Enabled | jeremyjacob101@gmail.com |

The one-cent alert description says “we've started getting billed at 1 cent shut everything down now”. That text is an operator note; it executes no action.

Budget alerts are informational, not automatic shutdowns or hard spending caps. Reporting, evaluation, and email delivery can lag, so charges may exceed a threshold before an operator responds. The historical check confirmed configuration; email delivery was not tested. The invoice remains authoritative. See [alert behavior](https://developers.cloudflare.com/billing/manage/budget-alerts/#how-budget-alerts-work).

## Recovery after the incident

1. Find and fix the runaway behavior before restoring access. Review retry behavior, scheduler frequency, and the incident's logs.
2. Create replacement R2 tokens with the appropriate bucket scope and least privilege: separate app readers from dataflow writers and development from production. Deleted tokens cannot simply be toggled back on. Follow [R2 token permissions and creation](https://developers.cloudflare.com/r2/api/tokens/).
3. Update the relevant Vercel environment credentials, Python runtime/scheduler secrets, CI secrets, and local environment credentials as applicable. Use the environment mappings in [artwork operations](catalog-artwork-r2.md) and [run artifact setup](cloudflare-run-artifacts.md). Never place actual credentials in this document, Git, or logs.
4. Restart or redeploy affected runtimes as needed to load the replacements. Restore access gradually, beginning with a small controlled workload, and monitor successful operations, storage, errors, and billing usage before resuming ordinary schedules.
