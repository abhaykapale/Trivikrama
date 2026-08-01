# BE-01B Authentication Infrastructure Adapters

This bundle implements the concrete adapters behind the BE-01A auth contracts without adding controllers or new features.

## Files to copy

Copy the `src/modules/auth/...` files into the same paths in `backend/`.

If your BE-01A contract names differ, do not duplicate contracts. Keep the existing contracts and wire these concrete classes through constructor injection. TypeScript structural typing will accept them if the method names match.

## Dependencies

```powershell
cd D:\Trivikrama\backend
npm install bcrypt jsonwebtoken
npm install -D @types/bcrypt @types/jsonwebtoken
```

## package.json scripts

Add these scripts:

```json
{
  "test:auth:be01b": "tsx tests/unit/auth/be01b-auth-infrastructure.test.ts",
  "test:auth:be01b:integration": "tsx tests/integration/auth/be01b-postgres-session-validator.integration.ts"
}
```

## Test commands

```powershell
npm run typecheck
npm run test:auth:be01b

$env:ALLOW_BE01B_INTEGRATION_TESTS = "true"
npm run test:auth:be01b:integration
Remove-Item Env:ALLOW_BE01B_INTEGRATION_TESTS
```

## Environment

Required:

```env
JWT_SECRET=<64+ random chars>
JWT_ACCESS_TOKEN_EXPIRY=1h
BCRYPT_SALT_ROUNDS=12
```

Optional:

```env
JWT_ISSUER=ai-siem
```
