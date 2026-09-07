# Tap Trade Localization Glossary

Use this glossary to keep core product terms consistent across locales. Translate full sentences naturally, but keep these product concepts stable wherever they appear.

Translations should sound like normal product UI copy on ecommerce, fintech, or news sites. Avoid word-for-word translations when they feel stiff or unnatural.

| English Term | Meaning / Usage |
|---|---|
| Prediction market | A market where users trade on the probability of an event outcome. |
| Market | A single tradable event or question. |
| Outcome | One possible result inside a market. |
| Yes | Positive outcome label. Keep short and scannable. |
| No | Negative outcome label. Keep short and scannable. |
| Points / pts | The in-app unit. Not money, not redeemable. Prices run 1–99 Points per contract; a correct contract settles at 100 Points. Keep "Points" as a product term — do not translate it into a local word for money or currency. |
| Contract | One unit of a Yes or No position. Shipped copy also says "share". |
| Liquidity | Depth available to trade against in a market, measured in Points. |
| Volume | Total trading activity. |
| Position | A user's holding or exposure in a market. |
| Portfolio | A user's collection of positions and activity. |
| Order | An instruction to buy or sell contracts (market or limit). |
| Resolve | To determine the final market outcome. |
| Resolution | The final decision/result of a market. |
| Oracle | Source or mechanism used to determine the result. |
| Balance | The user's available Points. The account surface labels this section "Points and Inventory". |
| Creator | User or system that created a market. |
| Settlement | Final accounting after a market resolves. |
| Active | Market or item is currently available. |
| Resolved | Market has a final outcome. |
| Closed | Market is no longer accepting new trades/orders. |
| Voided | Market was cancelled; Points spent are returned. |

## Terms that are not in this product

Do not introduce these when translating, and flag them if you find them in source copy:

- **Money, cash, deposit, withdraw, cash out, crypto, prize, redeem.** The launch model is a non-redeemable Points economy — there are no deposits, no withdrawals and no redemption. The gateway actively redacts this vocabulary from user-visible market copy (`internal/compliance/launch_safety.go`).
- **Connect Wallet.** There is no wallet-connect flow in the app.
- **Bet, wager, stake, odds, parlay, fixture, selection.** Sportsbook vocabulary from the pre-fork product. Users hold positions and place orders. A handful of legacy keys still spell "staked"/"wagering" in English source strings; translate those to the neutral Points phrasing rather than importing local gambling terms.

## Tone Guidance

- Navigation and buttons should be concise.
- Empty states should be helpful and conversational.
- Error messages should be clear, calm, and actionable.
- Points, balance, and responsible-play language should remain precise and should never imply cash value.
- Tagalog, Malay, and Indonesian translations may use common English loanwords where that is the normal consumer-web phrasing.

Locale files live at `apps/taptrade-platform/frontend/packages/app/public/static/locales/<locale>/<namespace>.json`. See `docs/i18n-implementation-notes.md`.

