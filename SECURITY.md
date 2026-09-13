# Security Policy / セキュリティポリシー

[ [English](#english) | [日本語](#japanese) ]

---

<a id="japanese"></a>
## 日本語

### サポート対象
このプロジェクトでは、以下の最新リリースおよび `main` ブランチに対してセキュリティアップデートを提供します。

| バージョン / ブランチ | サポート状況 |
| :--- | :--- |
| `main` ブランチ | :white_check_mark: サポート対象 |
| 過去のリリース | :x: 最新の `main` をご利用ください |

### 脆弱性の報告方法
本リポジトリ（特に `credential-safety` プラグイン等）において、セキュリティ上の欠陥や認証情報のマスキング漏れ・バイパス手法を発見した場合は、**公開Issueを作成しないでください**。エクスプロイトや機密情報が公に晒されるリスクを防ぐためです。

以下の手順で非公開報告をお願いいたします：

1. **GitHub Private Vulnerability Reporting（推奨）**
   - リポジトリの **[Security] タブ** を開き、**[Report a vulnerability]** をクリックして詳細を送信してください。
2. **非公開での連絡**
   - 上記が利用できない場合は、リポジトリメンテナのプロフィールに記載された連絡先まで詳細（再現手順、影響範囲、PoC）をお送りください。

### 対応の流れ
- 本プロジェクトは個人メンテナによって開発・保守されているため、報告は **ベストエフォート（可能な限り速やか）** で確認し、初期回答を行います。
- 修正が完了しリリースされるまで、脆弱性の詳細は非公開として扱われます。
- 修正リリース後、報告者のクレジット表記（希望される場合）とともにリリースノートにて告知します。

---

<a id="english"></a>
## English

### Supported Versions
We provide security updates for the following:

| Version / Branch | Supported |
| :--- | :--- |
| `main` branch | :white_check_mark: Supported |
| Older releases | :x: Please update to latest `main` |

### Reporting a Vulnerability
If you discover a security vulnerability or credential redaction bypass (especially in `credential-safety`), **please DO NOT open a public issue**. This prevents accidental exposure of sensitive keys or exploits.

Please report vulnerabilities privately:

1. **GitHub Private Vulnerability Reporting (Recommended)**
   - Navigate to the **[Security]** tab of this repository and click **[Report a vulnerability]**.
2. **Alternative Contact**
   - If the private reporting feature is unavailable, please reach out directly to the repository maintainer via contact info listed on their GitHub profile with reproduction steps and impact.

### Response Process
- As this is an independently maintained project, reports are reviewed and acknowledged on a **best-effort basis**.
- Vulnerability details will be kept confidential until a fix is released.
- Fixes will be credited in release notes unless anonymity is requested.
