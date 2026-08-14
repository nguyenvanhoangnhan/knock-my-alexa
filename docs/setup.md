# Setup

End-to-end setup, in order. Steps 1–2 are CLI; steps 3–8 happen in a browser (Amazon consoles); step 9 is the payoff.

## 1. Deploy the Worker (Cloudflare)

```sh
cd worker
npm install
npx wrangler kv namespace create TOKENS   # put the returned id into wrangler.jsonc
npx wrangler deploy
# generate two random secrets, e.g. openssl rand -hex 32
npx wrangler secret put TRIGGER_TOKEN
npx wrangler secret put DIRECTIVE_SECRET
```

Set `ALEXA_REGION` in `wrangler.jsonc` to match the **country of your Amazon account** (not where you live): `NA` (amazon.com), `EU` (amazon.co.uk/.de/…), `FE` (amazon.co.jp).

## 2. Deploy the Lambda shim (AWS)

Region must match the skill region: `us-east-1` for NA, `eu-west-1` for EU, `us-west-2` for FE.

```sh
aws iam create-role --role-name knock-my-alexa-lambda \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name knock-my-alexa-lambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

cd lambda && zip shim.zip index.mjs
aws lambda create-function --function-name knock-my-alexa-shim \
  --runtime nodejs22.x --handler index.handler --timeout 10 \
  --zip-file fileb://shim.zip \
  --role arn:aws:iam::<ACCOUNT_ID>:role/knock-my-alexa-lambda \
  --environment "Variables={WORKER_URL=https://<your-worker>.workers.dev,DIRECTIVE_SECRET=<DIRECTIVE_SECRET>}"
```

Note the returned function ARN — the skill needs it in step 4.

## 3. Create a Login with Amazon security profile

At https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html:

- **Create a New Security Profile** — name/description anything, any URL for the privacy policy.
- Note the profile's **Client ID** and **Client Secret** (used in step 5).

## 4. Create the Smart Home skill

At https://developer.amazon.com/alexa/console/ask:

- **Create Skill** → name it → model: **Smart Home** → payload **v3**.
- **Smart Home service endpoint → Default endpoint** = the Lambda ARN from step 2. Save.
- Note the **Skill ID** (`amzn1.ask.skill.…`), then allow the skill to invoke the Lambda:

```sh
aws lambda add-permission --function-name knock-my-alexa-shim \
  --statement-id alexa-smart-home --action lambda:InvokeFunction \
  --principal alexa-connectedhome.amazon.com --event-source-token <SKILL_ID>
```

The skill stays in **development mode** forever — that's fine, it works permanently on your own account.

## 5. Account linking

Skill console → **Account Linking**:

- Auth Code Grant
- Authorization URI: `https://www.amazon.com/ap/oa`
- Access Token URI: `https://api.amazon.com/auth/o2/token`
- Client ID / Secret: from the LWA profile (step 3)
- Scope: `profile`

Copy the three **Alexa Redirect URLs** shown at the bottom, then add them in the LWA console → your profile → **Web Settings → Allowed Return URLs**.

## 6. Send Alexa Events permission

Skill console → **Permissions** → toggle **Send Alexa Events** on. This reveals a *second* client id/secret pair (`amzn1.application-oa2-client.…`). Give it to the Worker:

```sh
cd worker
npx wrangler secret put ALEXA_CLIENT_ID
npx wrangler secret put ALEXA_CLIENT_SECRET
```

## 7. Enable and link the skill

Alexa app → More → Skills & Games → Your Skills → **Dev** → your skill → Enable, sign in with your Amazon account. Behind the scenes Alexa sends `AcceptGrant` → Lambda → Worker, which exchanges the grant code and stores tokens in KV. If this fails, the Alexa app shows a linking error — check `npx wrangler tail`.

## 8. Discover devices and create a Routine

- "Alexa, discover devices" (or app → Devices → +).
- The doorbell(s) from `worker/src/directives.ts` appear.
- App → Routines → **When**: doorbell is pressed → **Then**: announcement, TTS, lights — whatever you want.

## 9. Trigger it

```sh
curl -X POST https://<your-worker>.workers.dev/trigger \
  -H "Authorization: Bearer <TRIGGER_TOKEN>"
```

`{"ok":true,"gatewayStatus":202}` means Alexa accepted the doorbell press — the Routine runs.

## Optional: speak the actual message content

Routines can't carry dynamic text, so announcements with real content need one more piece — a **Custom skill** that the Routine opens, which then speaks whatever `/trigger` queued (this is also how Voice Monkey does it):

1. Create a second skill: **Custom** model, hosting "Provision your own", endpoint = the **same Lambda ARN**. Give it an invocation name (e.g. `knock messages`), add one dummy intent with any sample utterance so the model builds, then **Build Skill**.
2. Allow it to invoke the Lambda (note the different principal for custom skills):

```sh
aws lambda add-permission --function-name knock-my-alexa-shim \
  --statement-id alexa-custom-skill --action lambda:InvokeFunction \
  --principal alexa-appkit.amazon.com --event-source-token <CUSTOM_SKILL_ID>
```

3. Test tab → set to **Development** so the skill is live on your account.
4. Edit your Routine: *When doorbell is pressed → Add action → Skills → your custom skill.*
5. Send content with the trigger — `message` (plain text) or `speech` (raw SSML):

```sh
curl -X POST https://<your-worker>.workers.dev/trigger \
  -H "Authorization: Bearer <TRIGGER_TOKEN>" -H "content-type: application/json" \
  -d '{"message":"Someone knocked on the website"}'
```

The doorbell rings → the Routine opens the skill → the skill replies with the queued SSML → the Echo speaks it. Messages queue for 10 minutes and are spoken once.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `/trigger` → 409 "No LWA tokens stored yet" | AcceptGrant never ran — (re-)enable the skill with account linking (step 7) |
| Gateway 401 `INVALID_ACCESS_TOKEN_EXCEPTION` | `ALEXA_REGION` doesn't match your Amazon account region |
| Gateway 403 `SKILL_NEVER_ENABLED` | Skill disabled or was re-enabled without relinking |
| Devices not found during discovery | Lambda lacks the add-permission from step 4, or wrong endpoint ARN in the skill |
