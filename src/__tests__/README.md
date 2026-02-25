# Unit Test Contracts

These tests are written as executable behavior contracts.
Naming uses a mixed strategy:
- complex policy/config/account contracts use `Given / When / Then`
- simple pure-function behavior uses concise action-oriented names

## Core contracts

- `accounts.test.ts`: multi-account discovery, default account selection, credential resolution, merge precedence, account id normalization.
- `policy.test.ts`: allowlist matching, group policy enforcement, mention policy precedence.
- `targets.test.ts`: Feishu id detection, target normalization and formatting rules.
- `mention.test.ts`: mention extraction, forward-trigger rules, mention markup formatting.
- `tools-config.test.ts`: secure default tool flags and override merge behavior.
- `config-schema.test.ts`: schema defaults, strict key validation, `dmPolicy=open` wildcard requirement.
- `bot.parse.test.ts`: inbound message parsing contract for text/post and mention-forward context.
- `tools-common/tool-exec.test.ts`: tool account resolution and tool enablement enforcement.
- `text/markdown-links.test.ts`: URL normalization rules for Feishu markdown rendering.
