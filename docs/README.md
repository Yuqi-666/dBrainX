# dBrainX manuals

These manuals describe the current code and workflows for developers, operators, and users.

Chinese versions of these manuals are in [`zh/`](zh/README.md).

| Manual | Content |
| --- | --- |
| [Development](development.md) | Environment, development commands, desktop build, checks, and release |
| [Operations](operations.md) | Source and image deployment, update, access configuration, and backup |
| [Usage](usage.md) | Installation, update, and uninstall |
| [CI/CD pipeline](ci-cd.md) | Pull request checks, versioning, release candidates, publication, and repository policy |
| [Contributing](contributing.md) | How to propose and check a change |

## Manual maintenance

Run every command from the repository root. A section can state another directory, for example a release deployment directory.

Replace `RUN_ID`, `ATTEMPT`, `SOURCE_COMMIT`, and `VERSION` with real values. Read the variable definitions from the root `.env.example`, from `deploy/.env.example`, and from the named script.

The docs tree does not hold old release reports or verification logs. Read them from the Git history.


Do not commit credentials, personal data, or a full production log to the docs tree.
