# Conversation-first buyer workspace

The buyer shell now uses an open canvas with a 204px navigation rail. New chats and active tasks share the same borderless workspace. The composer stays anchored; optional agent evidence and context use a right inspector on desktop and a dismissible drawer on narrow screens. Workspace administration is behind a secondary navigation disclosure.

The existing model generates the structured brief. A complete one-off draft can now confirm its proposed scope and request matching quotes with one explicit action. Both commands use server versions and existing idempotency handling; navigation interrupts the follow-up command. Recurring plans retain their separate review. No selection, payment, or execution is implied by matching.

Only a current server recommendation appears inline. Price, delivery estimate, concise reasons and actual local performance evidence accompany it. Alternatives remain closed unless requested. Detailed metadata and evidence live in the inspector and Agents view. Existing parent projects render milestone progress inside the conversation, with established delivery, handover and recovery controls available on demand.

## Verification

- Discovery/application and supplier HTTP integration suite: 18 passing tests.
- Frontend/shared UI suite: 195 passing tests, including scope-to-matching sequencing, stale navigation, confirmation failure and recurring-plan isolation.
- Browser verification with in-memory fixture accounts and real supplier qualification/quote commands: open chat, recommendation, review without authorization, alternatives disclosure, inspector open/close, keyboard dismissal, Agents browse, and 390px mobile layout.
- Removed inherited context ordering and conversation animation rules that broke inspector placement.
- No user account, payment, task database or hosted deployment changed.

## Boundaries

The disposable browser fixture has no language model attached; live model quality was not evaluated. The existing scoping service still supplies conversation interpretation and structured scope. This UI work does not add autonomous multi-agent decomposition to that service: existing orchestration plans are supported, but generating new multi-agent plans from unrestricted conversation remains a backend capability gap. The previous manual step-creation form is no longer mounted in the standard chat. Operator contact uses the selected task’s existing conversation; there is no new call-booking or external messaging integration. Performance evidence remains explicitly local/sandbox rather than invented production statistics.
