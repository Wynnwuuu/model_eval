# Hidden owner magic access

This optional path lets one existing ManuEval user recover the same account without relying on future Feishu tenant membership. It does not change Feishu OAuth, the normal login screen, project permissions, or Feishu Base synchronization.

## Safe rollout

1. Deploy the code and migration with `OWNER_ACCESS_ENABLED=false`.
2. Generate credentials without writing them to disk:

   ```sh
   npm run owner-access:generate -- --base-url https://your-manueval-host
   ```

3. Save only the complete `magic_link` in a trusted password manager. Set the printed SHA-256 value as `EVAL_STUDIO_OWNER_ACCESS_KEY_SHA256_DEV`, and set `EVAL_STUDIO_OWNER_ACCESS_ENABLED_DEV` to `true`.
4. While the intended user still has a working Feishu login in that browser, open the complete magic link once. This atomically binds the existing `users.id`.
5. In a fresh private browser, open the same complete link and verify that the same user and project data appear.

The URL fragment is removed before the access request and is never placed in browser storage. The server stores only the bound user ID and session revocation version; the deployment stores only the key's SHA-256 value.

## Rotation, logout, and rollback

- Logging out increments `session_version`, immediately invalidating all earlier owner cookies. Reopening the saved magic link creates a current session.
- If the permanent key is lost or suspected to be exposed, generate a new one, replace the SHA-256 secret, and deploy. The existing database binding remains and every old owner cookie becomes invalid.
- To roll back, set `OWNER_ACCESS_ENABLED=false` or remove the new environment values. The hidden endpoint then behaves as not found and Feishu login continues unchanged.

Possession of the complete magic link grants all permissions of the bound user. Never commit it, paste it into tickets or chat, or expose it in screenshots and logs.
