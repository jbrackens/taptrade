# Social login setup — what you need to do

Everything on TapTrade's side is already built and deployed: the six buttons on the
sign-in page, the sign-in service's routes for each provider, the return addresses,
and the deploy step that copies credentials onto the demo server. The only missing
piece is a **client ID and secret from each provider**. Those are issued to you when
you register TapTrade as an app in each provider's developer console, under your own
account.

Until a provider has credentials, its button shows "…sign-in isn't configured for
this deployment yet." Once you add them, the next deploy turns that button on. No
code changes are needed.

## How the credentials reach the demo

```
Provider console ──(you copy ID + secret)──▶ GitHub repo secrets
GitHub repo secrets ──(every deploy)──▶ /opt/phoenix/.env on the demo box ──▶ auth service
```

- **Put credentials in GitHub secrets, not in chat.** Secrets are encrypted, never
  shown again after saving, and never enter this conversation or its logs. I never
  need to see the values.
- Every deploy of `main` writes the secrets into the server's environment. After
  you add secrets, tell me ("redeploy for social login") and I'll re-run the deploy
  and test each button.
- To change a credential later (rotation, new app): update the same secret and
  redeploy. Nothing else changes.

## The details every provider will ask for

| Field | Value |
|---|---|
| App name | TapTrade |
| Website / home page | `https://demo.99rtp.io` |
| Privacy policy | `https://demo.99rtp.io/privacy` |
| Terms of service | `https://demo.99rtp.io/terms` |
| App icon / logo | The TapTrade mark (square PNG; ask me for a 1024×1024 export if needed) |
| Authorised domain | `99rtp.io` (some consoles also want `demo.99rtp.io`) |
| Return address (redirect / callback URI) | `https://demo.99rtp.io/api/v1/auth/oauth/<provider>/callback` |

The return address must match **exactly**: `https`, no trailing slash, and the
provider's name as TapTrade spells it (`google`, `discord`, `twitter`, `facebook`,
`reddit`, `tiktok`). X's name is `twitter` in the address.

## The 12 GitHub secrets

| Provider | Secret for the ID | Secret for the secret |
|---|---|---|
| Google | `GOOGLE_OAUTH_CLIENT_ID` | `GOOGLE_OAUTH_CLIENT_SECRET` |
| Discord | `DISCORD_OAUTH_CLIENT_ID` | `DISCORD_OAUTH_CLIENT_SECRET` |
| X | `TWITTER_OAUTH_CLIENT_ID` | `TWITTER_OAUTH_CLIENT_SECRET` |
| Facebook | `FACEBOOK_OAUTH_CLIENT_ID` | `FACEBOOK_OAUTH_CLIENT_SECRET` |
| Reddit | `REDDIT_OAUTH_CLIENT_ID` | `REDDIT_OAUTH_CLIENT_SECRET` |
| TikTok | `TIKTOK_OAUTH_CLIENT_KEY` | `TIKTOK_OAUTH_CLIENT_SECRET` |

Names must be exactly as written (they are case-sensitive).

### Adding a secret

**In a terminal** (you'll be prompted for the value; it isn't echoed or saved in
your shell history):

```bash
gh secret set GOOGLE_OAUTH_CLIENT_ID -R jbrackens/taptrade
```

Repeat with each name.

**Or on github.com:** repository `jbrackens/taptrade` → **Settings** → **Secrets and
variables** → **Actions** → **New repository secret** → paste the name and the value
→ **Add secret**.

## Suggested order

| Order | Provider | Effort | Works for everyone right away? |
|---|---|---|---|
| 1 | Google | ~10 min | Test users only until you publish the consent screen |
| 2 | Discord | ~5 min | Yes |
| 3 | Reddit | ~5 min | Yes |
| 4 | X | ~15 min | Yes, once OAuth 2.0 is enabled on the app |
| 5 | Facebook | ~20 min | Only app admins/testers until the app is switched to Live |
| 6 | TikTok | ~20 min, then a review wait | Only after TikTok approves the app |

You don't have to do all six. Each provider switches on independently.

---

## 1. Google

TapTrade asks for: `openid email profile` (sign-in, email address, name and picture).

1. Go to **console.cloud.google.com** and sign in with the Google account that
   should own the app.
2. Create a project (top bar → project picker → **New project** → "TapTrade").
3. **APIs & Services → OAuth consent screen** (may be labelled **Google Auth
   Platform → Branding / Audience**):
   - User type: **External**.
   - App name, support email, logo, home page, privacy and terms links from the
     table above; authorised domain `99rtp.io`.
   - Scopes: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
   - Test users: add the Google accounts you'll test with.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name "TapTrade demo".
   - Authorised JavaScript origins: `https://demo.99rtp.io`
   - Authorised redirect URIs: `https://demo.99rtp.io/api/v1/auth/oauth/google/callback`
5. Copy the **Client ID** → secret `GOOGLE_OAUTH_CLIENT_ID`, and the
   **Client secret** → secret `GOOGLE_OAUTH_CLIENT_SECRET`.
6. When you want anyone (not only test users) to sign in: consent screen →
   **Publish app**. Basic scopes like these don't need Google's review, but Google
   may ask you to verify ownership of `99rtp.io`. That's a DNS record at the
   domain's DNS host (Cloudflare) or Google Search Console, and it's done by
   whoever controls the domain.

Google accounts have verified emails, so a Google sign-in with the same email as
an existing TapTrade account signs into that account.

## 2. Discord

TapTrade asks for: `identify email`.

1. Go to **discord.com/developers/applications** → **New Application** → "TapTrade".
2. **General Information**: add the icon, and the privacy and terms links.
3. **OAuth2**:
   - **Redirects → Add Redirect**: `https://demo.99rtp.io/api/v1/auth/oauth/discord/callback` → **Save Changes**.
   - Copy the **Client ID** → secret `DISCORD_OAUTH_CLIENT_ID`.
   - **Reset Secret** → copy it → secret `DISCORD_OAUTH_CLIENT_SECRET`. Discord shows
     it once.

Discord confirms verified emails, so it links to an existing account with the same
email, like Google.

## 3. Reddit

TapTrade asks for: `identity` (username only; Reddit shares no email).

1. Signed in to Reddit, go to **reddit.com/prefs/apps** → **create another app…**.
2. Name "TapTrade", type **web app**, about URL `https://demo.99rtp.io`,
   redirect URI `https://demo.99rtp.io/api/v1/auth/oauth/reddit/callback` →
   **create app**.
3. The **client ID** is the short string under the app's name ("web app") →
   secret `REDDIT_OAUTH_CLIENT_ID`. The **secret** field → secret
   `REDDIT_OAUTH_CLIENT_SECRET`.

Reddit may ask you to accept its Developer Terms / Data API terms for the account.

Without an email, a Reddit sign-in always creates its own TapTrade account. It
never links to an existing one.

## 4. X (Twitter)

TapTrade asks for: `tweet.read users.read` (the minimum X allows for reading the
signed-in user's profile). TapTrade never posts.

1. Go to **developer.x.com** → sign in → the developer portal. A **Free** tier
   account is enough for sign-in.
2. Create (or open) a **Project** and an **App** inside it.
3. In the app → **User authentication settings → Set up**:
   - App permissions: **Read**.
   - Type of App: **Web App, Automated App or Bot** (a *confidential* client).
   - Callback URI: `https://demo.99rtp.io/api/v1/auth/oauth/twitter/callback`
   - Website URL: `https://demo.99rtp.io`; terms and privacy links from the table.
   - **Save**.
4. X then shows the **OAuth 2.0 Client ID and Client Secret**. Use these, **not**
   the "API Key / API Secret" (those are OAuth 1.0a and won't work):
   Client ID → `TWITTER_OAUTH_CLIENT_ID`, Client Secret → `TWITTER_OAUTH_CLIENT_SECRET`.
   The secret is shown once; regenerate it under **Keys and tokens** if you miss it.

X shares no email, so an X sign-in creates its own TapTrade account.

## 5. Facebook (Meta)

TapTrade asks for: `email public_profile`.

1. Go to **developers.facebook.com** → **My Apps → Create App**. Choose the use case
   **Authenticate and request data from users with Facebook Login**, and name it
   "TapTrade".
2. **App settings → Basic**: add the privacy policy URL, terms URL, app icon and
   category. For **User data deletion**, choose "Data deletion instructions URL"
   and use `https://demo.99rtp.io/privacy`. **Save**.
3. **Facebook Login → Settings**:
   - Client OAuth login: on. Web OAuth login: on.
   - Valid OAuth Redirect URIs: `https://demo.99rtp.io/api/v1/auth/oauth/facebook/callback`
   - **Save changes**.
4. **App settings → Basic**: **App ID** → secret `FACEBOOK_OAUTH_CLIENT_ID`;
   **App secret** (click **Show**) → secret `FACEBOOK_OAUTH_CLIENT_SECRET`.
5. While the app is in **Development** mode, only people with a role on the app
   (admins, developers, testers) can sign in. Switch the app mode to **Live** to
   open it to everyone. `email` and `public_profile` are standard permissions and
   don't need App Review, but Meta may ask you to complete business verification.

Facebook doesn't mark emails as verified, so a Facebook sign-in creates its own
TapTrade account and doesn't link to an existing one.

## 6. TikTok

TapTrade asks for: `user.info.basic` (name and avatar; TikTok shares no email).

1. Go to **developers.tiktok.com** → sign in → **Manage apps → Connect an app**.
2. Fill in the app details (name, icon, category, description, terms and privacy
   links). Choose **Web** as the platform, website `https://demo.99rtp.io`.
3. **Add products → Login Kit**. Under Login Kit, add the redirect URI
   `https://demo.99rtp.io/api/v1/auth/oauth/tiktok/callback`. Scopes:
   `user.info.basic`.
4. If TikTok asks you to verify the domain or URL prefix, tell me what it asks for.
   A verification file can be added to the site; a DNS record has to be added by
   whoever controls the domain.
5. **Submit for review.** TikTok reviews Login Kit apps before they work for the
   public; until approval, only sandbox or test accounts can sign in.
6. From the app page: **Client key** → secret `TIKTOK_OAUTH_CLIENT_KEY`;
   **Client secret** → secret `TIKTOK_OAUTH_CLIENT_SECRET`.

TikTok shares no email, so a TikTok sign-in creates its own TapTrade account.

---

## When you're done

Tell me which providers you've added. I'll:

1. Re-run the demo deploy so the new secrets reach the server.
2. Check each provider's sign-in button now hands off to the provider's own
   sign-in screen (instead of the "not configured" message).
3. Report which ones work, and what each provider still needs (test users,
   publishing, review) before everyone can use it.

A full sign-in test needs a real account at each provider, so that last step is
yours: click the button, approve on the provider's screen, and you should land
back on TapTrade signed in.

## Troubleshooting

| What you see | Usual cause |
|---|---|
| "…sign-in isn't configured for this deployment yet" | Secret missing or misspelled, or not redeployed since adding it |
| Provider page says `redirect_uri_mismatch` / invalid redirect | The return address in the console doesn't match exactly (http vs https, trailing slash, `x` instead of `twitter`) |
| Provider page says invalid client / app not found | Wrong value in a secret (e.g. X's API Key used instead of its OAuth 2.0 Client ID), or the secret was regenerated after you copied it |
| "This app isn't verified" / only some people can sign in | Google consent screen not published, Facebook app still in Development, or TikTok review pending |
| Signed in but got a brand-new account | Expected for X, Reddit, TikTok and Facebook, which don't provide a verified email to link with |
