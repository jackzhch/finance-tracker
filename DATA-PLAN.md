# Data Plan

## Core source

- **Plaid connected financial accounts** — account names and masked digits, balances, posted bank/credit transactions, investment holdings, and security prices available through the user's linked institutions.
- Access happens only during a user-triggered or scheduled server-side sync. The `syncNow` action starts a background agent that follows the Plaid skill and writes through the artifact's typed actions.

## Storage and matching

- Existing `accounts`, `transactions`, and `holdings` rows remain in place; sync never clears them.
- Account matching prefers `~/workspace/finance-tracker-sync/account-map.json`; missing mappings are resolved by institution plus masked final four digits before any new account is added.
- Posted transactions are deduplicated by account, date, amount, description, and type. Pending transactions are not imported.
- Sync cursors and completion time are retained in `~/workspace/finance-tracker-sync/watermark.json`; user-visible sync state is stored in `sync_state`.

## Privacy and display

- The interface displays only institution names and masked final four digits for synced accounts.
- Full account numbers, Plaid account or credential identifiers, tokens, and transaction cursors are never returned to the interface or shown in status messages.
- All charts and totals are computed directly from stored imported or user-entered rows. No financial values are synthesized.
