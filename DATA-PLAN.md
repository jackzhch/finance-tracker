# Data Plan

## Core source

- **Plaid connected financial accounts** — account names and masked digits, balances, posted bank/credit transactions, investment holdings, and security prices available through the user's linked institutions.
- Access happens only during a user-triggered or scheduled server-side sync. The `syncNow` action starts a background agent that follows the Plaid skill and writes through the artifact's typed actions.

## Storage and matching

- Existing `accounts`, `transactions`, and `holdings` rows remain in place; sync never clears them.
- Account matching prefers `~/workspace/finance-tracker-sync/account-map.json`; missing mappings are resolved by institution plus masked final four digits before any new account is added.
- Plaid accounts whose type is `loan`, including `mortgage` subtypes such as PennyMac and Wells Fargo home loans, are stored as `loan` accounts with positive outstanding balances. The client deducts both loan and credit balances when calculating net worth.
- Posted transactions are deduplicated by account, date, amount, description, and type. Pending transactions are not imported.
- Sync cursors and completion time are retained in `~/workspace/finance-tracker-sync/watermark.json`; user-visible sync state is stored in `sync_state`.

## Privacy and display

- The interface displays only institution names and masked final four digits for synced accounts.
- Full account numbers, Plaid account or credential identifiers, tokens, and transaction cursors are never returned to the interface or shown in status messages.
- All charts and totals are computed directly from stored imported or user-entered rows. No financial values are synthesized.

## Credit-card benefit reference data

- Existing accounts whose type is `credit` are mirrored into the card-benefit workspace by linked account ID. The card itself remains editable because bank feeds may omit or abbreviate the product name.
- Standard annual fees and benefit templates are applied only when the stored account name clearly matches a supported product; unmatched cards are added with an explicit “card type not confirmed” note and no invented benefits.
- Capital One Venture X fee and standard travel benefits: https://www.capitalone.com/credit-cards/venture-x/?irgwc=1&afsrc=1&external_id=IRAFF_ZZb385def50ec242698f0d0669b50f7188_USCIR_K102401_A344893L_C_S28049_P&pscid=&oC=eZan6vxLBE&applicationprefillid=
- Chase Sapphire and Freedom product fees/reward summaries: https://Creditcards.chase.com/rewards-credit-cards?iCELL=6H4S&CID=MKT3
- Bilt Blue product fee and standard benefit summary: https://www.bilt.com/card/blue
- Discover it product reward summary: https://www.discover.com/credit-cards/brnd/?cmpgnid=dp-dbr-inet-cdt-sc-fb-AERG-D-NT&iq_id=dp-dbr-inet-cdt-sc-fb-AERG-D-NT
- These public values are editable defaults rather than claims about a specific user agreement. User-entered points and realized benefit values remain separate from the reference defaults.
