# CRM handoff: Quote source key (stop using iacrm_amsexternalid on quotes)

For: the CRM enhancement session (BettersInsuranceCRM repo, Git > PR > dev, ADO tracked). DEV only; no production promotion without Nathan's instruction.
From: the QuoteCraftZ session, which has already built the extension side against the contract below.

## Why

`iacrm_amsexternalid` belongs to the AMS (NowCerts) sync. QuoteCraftZ, and the EZLynx Quote Bridge before it, used it on `iacrm_quote` as its own "already loaded" key, through an alternate key on (`iacrm_provider`, `iacrm_amsexternalid`). That breaks the standing rule. A quoting tool's key in that column can also be mistaken for an AMS record id by the sync.

From the next QuoteCraftZ release, the extension **never writes `iacrm_amsexternalid`**. It reads it only to recognize quotes that older versions already loaded.

## 1. New column on Quote (`iacrm_quote`)

| Column | Schema name | Type | Notes |
|---|---|---|---|
| Source Quote Key | iacrm_SourceQuoteKey | Text 200, optional, searchable | Logical name **`iacrm_sourcequotekey`** (the extension uses exactly this name) |

Values the extension writes:
- EZLynx quotes: `ezlynx:<quote id>:<req or altN>`
- Carrier portal quotes: `<site host>:<opportunity id>`, one per site per opportunity

Recommended: an alternate key on (`iacrm_provider`, `iacrm_sourcequotekey`) so CRM itself refuses duplicates. The extension does **not** depend on it. It looks quotes up and then updates by record id or creates.

## 2. Data fix for quotes already loaded

For every `iacrm_quote` where `iacrm_provider` is `EZLynx` or `Portal` and `iacrm_amsexternalid` is not empty:
1. copy `iacrm_amsexternalid` into `iacrm_sourcequotekey`;
2. then clear `iacrm_amsexternalid`.

Do it in that order: the extension finds a quote by the source key first, then the legacy value, so no reload creates a duplicate at any point. Report the row count from DEV, and check prod before any promotion.

## 3. Remove the old alternate key

If an alternate key on (`iacrm_provider`, `iacrm_amsexternalid`) exists on `iacrm_quote`, remove it after step 2. Nothing in QuoteCraftZ addresses quotes through it any more.

## 4. AMS isolation

- `iacrm_sourcequotekey` never syncs to NowCerts and is not part of any AMS mapping.
- Check the AMS sync does not treat quote rows as AMS-linked just because `iacrm_amsexternalid` was set; after step 2 those values are gone.

## 5. Security

Same privileges as the other quote columns. The extension's app user needs read and write on `iacrm_sourcequotekey`.

## 6. Report back to the QuoteCraftZ session

- The column's logical name if it differs from `iacrm_sourcequotekey` (the extension would need a one-line change).
- Whether the alternate key on (`iacrm_provider`, `iacrm_sourcequotekey`) was added.
- Rows migrated in step 2, and that the old alternate key is gone.

## What QuoteCraftZ already does

- Before writing quotes, it looks each one up, in this order:
  1. by `iacrm_sourcequotekey`;
  2. by the legacy `iacrm_amsexternalid` value (read only);
  3. by the same quote name on the same opportunity.
- A match is updated by its record id (`PATCH iacrm_quotes(<id>)`), and anything else is created (`POST iacrm_quotes`).
- `iacrm_sourcequotekey` is written once the column exists. Until then, the lookup works without it, and new quotes are recognized on reload by name and opportunity.
- An existing Firm premium status is never downgraded to Estimated.
