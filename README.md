# UNOMED + NEETHI Sales Portal — guided starter

## Configure
Open `src/config.js` in a text editor. Replace the two placeholder strings with your Supabase Project URL and `sb_publishable_...` key. Never use a `sb_secret_` or `service_role` key in browser code.

## Run on Windows
1. Install Node.js LTS from https://nodejs.org/ and VS Code from https://code.visualstudio.com/.
2. Extract this ZIP to a folder such as `C:\\unomed-neethi-web-starter`.
3. Open the folder in VS Code.
4. Open Terminal > New Terminal and run `npx serve .` (accept package installation only if you trust the package).
5. Open the local URL printed in the terminal.

Alternatively, use VS Code Live Server. Opening index.html directly as a file will not work because this app uses JavaScript modules.

## Supabase assumptions
- Users already exist in Authentication and have active rows in `public.profiles`.
- The branch table is populated.
- RLS stays enabled; never put secret/service-role keys in frontend code.

## Important: pilot only, not production-ready
- The app relies on your existing RLS policies, which have not yet been tested from separate authenticated sessions.
- Report and package rows are submitted in two requests. If package insertion fails, the report may already exist; check the database before retrying.
- This scaffold does not yet implement monthly targets, branch ranking, correction approval, audit logs, pagination, or an atomic submission function.
- Metrics are preliminary and should not be treated as final business reports until pagination and target logic are completed.
- Do not enter real sales data or deploy for staff use until role-based access tests pass.
