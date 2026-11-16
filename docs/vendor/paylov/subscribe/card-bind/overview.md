---
source_url: https://developer.paylov.uz/subscribe/card-bind/overview
---

# Card Bind

Flow for binding a payment card of the partner mobile app users via Paylov, backend integration and receiving the webhook.

Why it works this way

Since the partner has no PCI DSS certificate, the card number (PAN) never reaches the partner's backend or frontend code. The card number is entered only on a protected page (webview) on the Paylov domain. The partner only receives the ready `cardId` and the bind result.

## Flow

1. The partner backend requests a one-time bind link (`bindUrl`) from Paylov — [Create Bind Link](https://developer.paylov.uz/subscribe/card-bind/create-link).

2. The partner app opens this link in a webview. The user enters the card number and confirms the SMS code — the card is activated on the Paylov side.

3. Paylov sends a webhook to the partner backend with the card ID and card details — [Webhook](https://developer.paylov.uz/subscribe/card-bind/webhook).

4. *(Optional)* If the webhook does not arrive, the partner backend checks the result itself — [Bind Status](https://developer.paylov.uz/subscribe/card-bind/status).

The internal logic of the webview page (design, form, SMS input) **is provided by the Paylov frontend team** — no additional work is required from the partner.

## Authentication

Backend requests (creating the link and checking the status) use the same merchant Bearer token as the existing Paylov Subscribe API:

```http
Authorization: Bearer < ACCESS_TOKEN >
```

The webview does not require any token — it works only with the one-time `token` received when creating the link, which is already embedded in `bindUrl`.

## Opening the webview

The partner only opens the received `bindUrl` in a regular webview component.

**Android (Kotlin) — example**

```kotlin
val webView = WebView(context)
webView.settings.javaScriptEnabled = true
webView.loadUrl(bindUrl) // bindUrl from the create link response
```

**iOS (Swift, WKWebView) — example**

```swift
let webView = WKWebView(frame: view.bounds)
webView.load(URLRequest(url: URL(string: bindUrl)!))
```

**React Native — example**

```jsx
import { WebView } from 'react-native-webview';

<WebView source={{ uri: bindUrl }} />
```

The user enters the card number on the page and confirms the SMS code. When the process is finished, the page may redirect to `returnUrl` (if it was passed when creating the link) — in this case the partner app should close the webview. The **primary and reliable source of the result** is the webhook, not the webview itself.

## After binding

Once you have the `cardId`, use it with the existing Paylov Subscribe API as usual — nothing changes here:

| Endpoint | Purpose |
| --- | --- |
| [`GET /merchant/userCard/getCard/{cardId}/`](https://developer.paylov.uz/subscribe/get-single-card) | Get card details and balance |
| [`GET /merchant/userCard/getAllUserCards/`](https://developer.paylov.uz/subscribe/get-users-card) | All cards of the user |
| [`DELETE /merchant/userCard/deleteUserCard/`](https://developer.paylov.uz/subscribe/delete-user-card) | Delete the card |
| [`POST /merchant/receipts/pay/`](https://developer.paylov.uz/subscribe/payment/confirm-payment), etc. | Pay with `cardId` |

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `permission_denied` | 400 | Merchant is not connected to the Subscribe API or the token is invalid |
| `link_expired` | 400 | The link has expired (about 20 minutes) |
| `link_already_used` | 400 | A card has already been bound with this link |

## Security — summary

- The card number (PAN) never reaches any part of the partner system (frontend, backend, logs).

- The webview link is one-time and temporary — it cannot be reused.

- The webhook is protected with Basic Auth — the login/password are known only to the partner and Paylov.

- All requests must be made over HTTPS.

## Notes (extraction)
- The Kotlin example comment is translated in RU/UZ; executable code agrees. The Authorization example contains spaces inside < ACCESS_TOKEN > in all versions.
- Complete literal code/example differences for RU (including whitespace and translated comments):

```diff
--- EN code blocks
+++ RU code blocks
@@ -2,7 +2,7 @@
 
 val webView = WebView(context)
 webView.settings.javaScriptEnabled = true
-webView.loadUrl(bindUrl) // bindUrl from the create link response
+webView.loadUrl(bindUrl) // bindUrl получен из ответа на создание ссылки
 
 let webView = WKWebView(frame: view.bounds)
 webView.load(URLRequest(url: URL(string: bindUrl)!))
```
- Complete literal code/example differences for UZ (including whitespace and translated comments):

```diff
--- EN code blocks
+++ UZ code blocks
@@ -2,7 +2,7 @@
 
 val webView = WebView(context)
 webView.settings.javaScriptEnabled = true
-webView.loadUrl(bindUrl) // bindUrl from the create link response
+webView.loadUrl(bindUrl) // bindUrl — havola yaratish javobidan olingan
 
 let webView = WKWebView(frame: view.bounds)
 webView.load(URLRequest(url: URL(string: bindUrl)!))
```
