# Railway Variables — Tambahkan Manual

Buka Railway → temride-backend → Variables → Raw Editor → tambahkan:

```
FIREBASE_PROJECT_ID=temride-4d416
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@temride-4d416.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY_ID=9926f798170ed8bece6cbdf7fae7aa272c1e0160
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC0EQtBbPj9jUiv\n35Tam6LXyoBMgZ6WM/EsOhXC3yvBAbGmo2BkY9s0VGVPIzEX2WP92dJ3m5DeWNmb\nx6v1IXD4dUzz/B0+tsrX3SYdVCslweWcjPrIsFau9uRpsyh5EsZg/XCjBhGPEQgC\ndskWIOtBV3s3hfC4W+3vowhvojsqim30d9wtT18A8pZ4S3JXwsL8fQ0eAwTy+ESn\n7yPq/wHYE5ZUMN9jvjxOpTO9bnKCjJLlPGxeBCwsP82A+hibKM59TaQvxvIbA5wL\n3iGBfxzRe2+/oOmuqbxB6FZCDR2aTOPhc+bCMG3TxRENKGapf/JmBwoH2/8oJhve\nOgiLkJxbAgMBAAECggEAJAs3XBDSpHpn/uB73OiDh7t+xBG8K2fZUleMLJZcnUVY\nCLmyXVYJtmdgYh9yv8nhtJoqAYwvyvoxEPg+iRJ5GRrt3Pbt6bRQVTZs3zkOa//s\nlNI5jvuRVnOQVEIrC1VBRX/l0JQx5pfrqQabCOVtAgbfYMVcYqLwNWRGl4X7Xu/B\nzkItJHSbkfqHU+fBAC5X8gUr/TXDEn5nfE/yOi42/QsVr8BZoAjNcm9FMUnm5GWx\n2gBL/Vk2gJe1TiQ2OaFvglK7vB6kkHdhLjALpgHo7tZXV+nl3nkvNeUEH6Bh7BfA\n1HFfWuLquH2fmJ1M1pbAQ5l+5wI2MrUTedijPBb+BQKBgQDY1HTQK3o2mos4i2Y6\nidsfJRr4vWKNRE8AxhJcahphhvwFFDSqbIL/5NHYAJrHC0eiQ4q3uG/pfP/Q3g0H\nvy9JNDBmNvVRgzfptjwd3IGEYyZ3EZjTWOaBnA3iZDLAm/FXYii4+0YTVpUMaW58\nODRlYsbQeoZ4b8BJPi5Cl0B19wKBgQDUmG0PmuEhIROsXWn5+WBTEuPcMB5q+S/v\nQ3SUzXMFC5ILkc73EXhOhyRNPLt35ydP7S7NlVlUb83v0YGzOO2zshPdQGZw1Eqg\nFlLbbxmyhtYxQcVGKtlu0/ElxGB0p8JItcYkpiK6gvUGOa/WZ0XRA31fi+1EMnwB\n0AUeBL1jvQKBgHxLTasHQUeLz8LaJf/ohnOUEaIE7jmMrr0CzgOrzvOZLV679nS7\nP1zxDlmD/zWagbXCggJO99ggj4RrxYxrS+/qutPdLUNMtQCENnHntVbuf15B+Bkv\nHPOvQUZFqdI/kllFK5Led40eVNKInY0XqvFzbgSUOAFSDifuPRZvHcSBAoGAZKym\nANzMPb8HLPmzpN/WIKDybKQQ04GblIdyHsFH9ZysFXR/+Po56Z4Pr8/Ryw8Yy727\nCzntapHjiOzCqdeMoSr0QzMrD8VIbZUEuctb9PHrXroRrI/AFb6iFMtxDe0fkQUb\nhuFx0rcPR1psDXEsW7V2WpfNzRzHIqias8N02FUCgYBwfg29DPffpUOehfc3JwI9\n1rwiuOV91f77C5sMrkyovbmWL7jfd2lvZrp+JVhnZEPeZqn1GlokU+1E7aARhndN\nqdlJQI+m77O+Y1PXtUebr9N8eeUMbYr63azbYD0zSZxSFUVJIpgqjXlBz9xkSgjA\nKH5Z9YJYscZbjqbY450a/g==\n-----END PRIVATE KEY-----\n
```

## Catatan Penting

- **FIREBASE_PRIVATE_KEY** harus dalam satu baris dengan `\n` literal (bukan newline nyata)
- Railway Raw Editor akan handle formatting dengan benar
- Setelah save → Railway otomatis redeploy backend

## Verifikasi

Setelah deploy, cek endpoint:
```
GET https://<your-railway-url>/api/test/notification
```

Response yang diharapkan:
```json
{
  "firebase_configured": true,
  "project_id": "temride-4d416",
  "fonnte_configured": true/false,
  "midtrans_configured": true/false
}
```
