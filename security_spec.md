# Security Specification for EvalTrack

## Data Invariants
1. **User Ownership**: Users can only modify their own profiles.
2. **Project Integrity**: Projects can only be modified by the initiator or an admin.
3. **Task Atomicity**: Tasks require a valid dataset and template.
4. **Vote Integrity**: A user can only write their own votes. A vote cannot be modified once cast (unless by admin).
5. **Role Escalation**: Regular users cannot change their own roles to 'admin'.
6. **Dataset/Template Safety**: These resources can only be modified by their creators or admins.

## The "Dirty Dozen" Payloads

1. **Self-Admin Promotion**:
   - Path: `/users/hacker-uid`
   - Payload: `{ "role": "admin" }` (Update)
   - Reason: User attempting to escalate privileges.

2. **Poisoned Project ID**:
   - Path: `/projects/VERY_LONG_STRING_OVER_128_CHARS...`
   - Payload: `{ "name": "Junk" }` (Create)
   - Reason: Denial of Wallet via massive ID strings.

3. **Orphaned Task**:
   - Path: `/evalTasks/task-1`
   - Payload: `{ "name": "Task", "datasetId": "non-existent-ds" }` (Create)
   - Reason: Inconsistent data state.

4. **Vote Spoofing**:
   - Path: `/evalTasks/task-1/userVotes/victim-uid`
   - Payload: `{ "vote": "A", "userUid": "hacker-uid" }` (Create)
   - Reason: Impersonating another user's vote.

5. **Template Hijack**:
   - Path: `/evalTemplates/template-1`
   - Payload: `{ "name": "Renamed", "creatorUid": "hacker-uid" }` (Update)
   - Reason: Non-creator trying to modify a shared template.

6. **Terminal State Bypass**:
   - Path: `/evalTasks/task-1`
   - Payload: `{ "status": "draft" }` (Update where existing status is "completed")
   - Reason: Reverting a completed task.

7. **PII Leak Attempt**:
   - Path: `/users/victim-uid`
   - Operation: `get` by non-admin, non-owner.
   - Reason: Accessing private user data.

8. **Shadow Field Injection**:
   - Path: `/projects/project-1`
   - Payload: `{ "name": "Valid Name", "isSecretAdminOnly": true }` (Create)
   - Reason: Injecting fields not in schema.

9. **Timestamp Fraud**:
   - Path: `/evalDatasets/ds-1`
   - Payload: `{ "createdAt": 0 }` (Create)
   - Reason: Faking creation time.

10. **Massive List Attack**:
    - Path: `/evalTasks/task-1`
    - Payload: `{ "assignees": ["a", "b", ... 10000 items] }` (Update)
    - Reason: Resource exhaustion.

11. **ID Character Injection**:
    - Path: `/projects/project!@#$%^&*()`
    - Payload: `{ "name": "Test" }` (Create)
    - Reason: Testing ID validation regex.

12. **Unauthenticated Write**:
    - Path: `/evalDatasets/ds-1`
    - Payload: `{ "name": "Data" }` (Create)
    - Reason: Testing default-deny for guests.

## Test Runner

```typescript
test("Self-Admin Promotion should fail", async () => {
  const response = await fetch(`${API_BASE_URL}/api/projects/project-1/members/alice`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": "alice",
      "X-User-Email": "alice@example.com"
    },
    body: JSON.stringify({
      member: { email: "alice@example.com", role: "owner" }
    })
  });
  expect(response.status).toBe(403);
});

// ... More tests for each dirty dozen payload
```
